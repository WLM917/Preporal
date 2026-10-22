/* ═══════════════════════════════════════════════════════════
   tests/veille.test.mjs

   Supabase met en pause un projet gratuit après une semaine de
   faible activité. C'est arrivé : l'adresse du projet a disparu
   du DNS, et le site entier est devenu inutilisable — connexion,
   simulations, historique.

   /api/veille fait une lecture minuscule chaque jour pour que la
   base ne soit jamais jugée inactive. Deux choses comptent :

   • qu'elle tourne vraiment — une lecture, pas une réponse en
     cache, et pas un refus parce qu'un secret n'a pas été réglé ;
   • qu'elle ne casse rien — le plan gratuit de Vercel refuse de
     DÉPLOYER le site si une tâche tourne plus d'une fois par jour.
   ═══════════════════════════════════════════════════════════ */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

const etat = globalThis.__double = { lectures: 0, panne: false, limite: false };

const SUPABASE = 'data:text/javascript,' + encodeURIComponent(`
  const e = globalThis.__double;
  export const supabaseAdmin = () => ({
    from: () => ({ select: () => ({ limit: async () => {
      e.lectures++;
      return e.panne
        ? { data: null, error: { message: 'TypeError: fetch failed' } }
        : { data: [{ id: 'un-identifiant-qui-ne-doit-pas-sortir' }], error: null };
    } }) })
  });`);
const IA = 'data:text/javascript,' + encodeURIComponent(`
  export async function limiter(req, res) {
    if (globalThis.__double.limite) { res.status(429).json({ erreur: 'Trop de requêtes.' }); return false; }
    return true;
  }`);
register('data:text/javascript,' + encodeURIComponent(`
  const SUPABASE = ${JSON.stringify(SUPABASE)};
  const IA = ${JSON.stringify(IA)};
  export async function resolve(specifier, context, suivant) {
    if (specifier.endsWith('supabaseAdmin.js')) return { url: SUPABASE, shortCircuit: true };
    if (specifier.endsWith('/ia.js')) return { url: IA, shortCircuit: true };
    return suivant(specifier, context);
  }`));

const { default: handler } = await import('../api/veille.js');

async function appeler({ methode = 'GET', autorisation } = {}) {
  let code = 0, corps = null; const entetes = {};
  const res = {
    status(c) { code = c; return this; },
    json(j) { corps = j; return this; },
    setHeader(k, v) { entetes[k.toLowerCase()] = v; }
  };
  const avant = console.error;
  console.error = () => {};
  try {
    await handler({ method: methode, headers: autorisation ? { authorization: autorisation } : {} }, res);
  } finally { console.error = avant; }
  return { code, corps, entetes };
}

beforeEach(() => {
  etat.lectures = 0; etat.panne = false; etat.limite = false;
  delete process.env.CRON_SECRET;
});


test("l'appel quotidien lit vraiment la base", async () => {
  const r = await appeler();
  assert.equal(r.code, 200);
  assert.equal(etat.lectures, 1, 'sans lecture, la base reste jugée inactive');
  assert.deepEqual(r.corps, { ok: true });
});

test('rien de ce qui est lu ne sort', async () => {
  const r = await appeler();
  assert.ok(!JSON.stringify(r.corps).includes('identifiant'),
    'la route dit si la base répond, jamais ce qu\'elle contient');
});

test('la réponse ne peut pas être mise en cache', async () => {
  /* Une réponse servie depuis un cache ne ferait pas tourner la
     fonction : la base ne serait plus réveillée. */
  const r = await appeler();
  assert.equal(r.entetes['cache-control'], 'no-store');
});

test('une base qui ne répond pas se lit dans les journaux de la tâche', async () => {
  etat.panne = true;
  const r = await appeler();
  assert.equal(r.code, 503, 'Vercel ne relance pas une tâche qui échoue : il faut au moins que l\'échec se voie');
  assert.equal(r.corps.ok, false);
});

test('sans CRON_SECRET, la route fonctionne — un réglage oublié ne doit pas endormir la base', async () => {
  const r = await appeler();
  assert.equal(r.code, 200);
});

test('avec CRON_SECRET, seul Vercel peut l\'appeler', async () => {
  process.env.CRON_SECRET = 'secret-de-test-assez-long';
  assert.equal((await appeler()).code, 401);
  assert.equal((await appeler({ autorisation: 'Bearer autre-chose' })).code, 401);
  assert.equal(etat.lectures, 0, 'un appel refusé ne touche pas la base');
  assert.equal((await appeler({ autorisation: 'Bearer secret-de-test-assez-long' })).code, 200);
  assert.equal(etat.lectures, 1);
});

test('sans secret, le débit est borné', async () => {
  etat.limite = true;
  assert.equal((await appeler()).code, 429);
  assert.equal(etat.lectures, 0);
});

test('seul GET est accepté — c\'est la méthode qu\'emploie Vercel', async () => {
  assert.equal((await appeler({ methode: 'POST' })).code, 405);
  assert.equal(etat.lectures, 0);
});


/* ── La planification ───────────────────────────────────────── */

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('la tâche est planifiée sur cette route', () => {
  const taches = (vercel.crons || []).filter(c => c.path === '/api/veille');
  assert.equal(taches.length, 1, 'sans planification, la route ne sert à rien');
});

test("la tâche tourne une fois par jour, jamais plus — sinon Vercel refuse de déployer le site", () => {
  /* « Hobby accounts are limited to daily cron jobs. This cron
     expression would run more than once per day. » Le déploiement
     ENTIER échoue : plus aucune correction ne passerait en ligne. */
  for (const { path, schedule } of vercel.crons || []) {
    const [minute, heure, ...reste] = schedule.trim().split(/\s+/);
    assert.equal(reste.length, 3, `${path} : expression à cinq champs attendue`);
    assert.match(minute, /^\d{1,2}$/, `${path} : une seule minute, pas « ${minute} »`);
    assert.match(heure, /^\d{1,2}$/, `${path} : une seule heure, pas « ${heure} »`);
    assert.ok(Number(minute) < 60 && Number(heure) < 24, `${path} : horaire impossible`);
  }
});

test('la base ne peut pas rester une semaine sans activité', () => {
  /* Supabase met en pause après sept jours de faible activité : une
     tâche hebdomadaire laisserait passer des trous. Le jour du mois et
     le jour de la semaine doivent rester libres. */
  const { schedule } = vercel.crons.find(c => c.path === '/api/veille');
  const [, , jourDuMois, mois, jourDeSemaine] = schedule.trim().split(/\s+/);
  assert.deepEqual([jourDuMois, mois, jourDeSemaine], ['*', '*', '*'],
    'la tâche doit tourner tous les jours');
});
