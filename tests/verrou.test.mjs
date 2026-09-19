/* ═══════════════════════════════════════════════════════════
   tests/verrou.test.mjs

   Le bouton « Enregistrer » restait vingt secondes sur
   « Enregistrement… » puis affichait « Le serveur n'a pas
   répondu ». Le serveur répondait très bien : la requête ne
   partait jamais.

   Mesuré dans @supabase/auth-js@2.65.0, servi par esm.sh :

     async updateUser(e, t = {}) {
       return await this.initializePromise,
         await this._acquireLock(-1, …)
     }

     async function navigatorLock(o, e, t) {
       const r = new AbortController();
       e > 0 && setTimeout(() => r.abort(), e);     // ← e vaut -1
       return await navigator.locks.request(o, { signal: r.signal }, …)
     }

     async _notifyAllSubscribers(e, t) {
       const n = [...emitters].map(async a => { await a.callback(e, t) });
       await Promise.all(n);                        // ← dans le verrou
     }

   Donc : updateUser attend le verrou sans limite de temps, et le
   verrou reste pris tant qu'un rappel onAuthStateChange n'a pas
   fini. Notre rappel interrogeait la table profils. Ces tests
   tiennent les deux bouts.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileDAttente } from '../js/verrou.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const auth = readFileSync(join(RACINE, 'js', 'auth.js'), 'utf8');

test('la file sérialise : deux écritures ne se chevauchent pas', async () => {
  const verrou = fileDAttente();
  const trace = [];
  const dormir = ms => new Promise(ok => setTimeout(ok, ms));

  await Promise.all([
    verrou('a', -1, async () => { trace.push('1 début'); await dormir(20); trace.push('1 fin'); }),
    verrou('a', -1, async () => { trace.push('2 début'); await dormir(1); trace.push('2 fin'); })
  ]);

  assert.deepEqual(trace, ['1 début', '1 fin', '2 début', '2 fin'],
    'la seconde opération doit attendre la fin de la première');
});

test('la file rend la valeur de ce qu’elle exécute', async () => {
  const verrou = fileDAttente();
  assert.equal(await verrou('a', -1, async () => 42), 42);
});

test('un échec ne condamne pas la suite de la file', async () => {
  const verrou = fileDAttente();

  await assert.rejects(() => verrou('a', -1, async () => { throw new Error('raté'); }));

  /* C'est le cœur du sujet : après un échec, le verrou doit rester
     utilisable. Un verrou qui ne se rend plus est exactement ce qui
     figeait « Enregistrer ». */
  assert.equal(await verrou('a', -1, async () => 'toujours là'), 'toujours là');
});

test('la file ne dépend jamais de navigator.locks', async () => {
  const verrou = fileDAttente();
  // Node expose navigator en lecture seule : on redéfinit la propriété.
  const avant = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  // Un navigateur dont le verrou partagé ne répond plus.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: () => new Promise(() => {}) } }
  });
  try {
    const gagne = await Promise.race([
      verrou('a', -1, async () => 'abouti'),
      new Promise(ok => setTimeout(() => ok('figé'), 150))
    ]);
    assert.equal(gagne, 'abouti', 'un verrou partagé bloqué ne doit rien bloquer ici');
  } finally {
    if (avant) Object.defineProperty(globalThis, 'navigator', avant);
    else delete globalThis.navigator;
  }
});

test('le client Supabase reçoit cette file à la place de navigator.locks', () => {
  const appel = auth.slice(auth.indexOf('createClient(CONFIG.supabase.url'));
  assert.match(appel.slice(0, 200), /lock:\s*fileDAttente\(\)/,
    'sans lock explicite, supabase-js reprend navigator.locks et son attente sans fin');
});

test('le rappel de changement de session rend la main tout de suite', () => {
  const debut = auth.indexOf('onAuthStateChange(');
  assert.ok(debut > -1, 'le rappel de session a disparu');
  const rappel = auth.slice(debut, auth.indexOf('\n    });', debut));

  /* La propriété, et non le moyen : le rappel ne doit rien attendre.
     supabase-js fait « await Promise.all(rappels) » à l'intérieur du
     verrou ; le moindre await ici garde le verrou pris, et le
     updateUser du bouton « Enregistrer » attend derrière, sans fin. */
  assert.doesNotMatch(rappel, /\bawait\b/,
    'un await dans ce rappel garde le verrou pris et fige « Enregistrer »');
  assert.match(rappel, /setTimeout/,
    'le travail doit reprendre au tour de boucle suivant, verrou rendu');
  assert.match(rappel, /appliquerSession/,
    'le travail doit tout de même être fait');
});
