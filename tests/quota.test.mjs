/* ═══════════════════════════════════════════════════════════
   tests/quota.test.mjs

   Le quota des simulations gratuites est la seule chose qui
   sépare le service d'une facture de modèle illimitée. Il est
   donc testé contre un faux serveur REST Supabase, avec le vrai
   client supabase-js.
   ═══════════════════════════════════════════════════════════ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const tables = { profils: new Map(), usages: new Map(), usages_anonymes: new Map() };
const cleDe = t => (t === 'usages_anonymes' ? 'empreinte' : t === 'usages' ? 'utilisateur_id' : 'id');

let serveur, quota;

before(async () => {
  serveur = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const table = u.pathname.replace('/rest/v1/', '');
    const envoyer = (code, corps) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };
    if (u.pathname === '/auth/v1/user') return envoyer(401, { message: 'pas de session' });
    if (!tables[table]) return envoyer(404, { message: 'table inconnue' });

    if (req.method === 'GET') {
      const filtre = u.searchParams.get(cleDe(table));
      const val = filtre ? filtre.replace(/^eq\./, '') : null;
      const ligne = tables[table].get(val);
      return envoyer(200, ligne ? [ligne] : []);
    }
    if (req.method === 'POST') {
      let corps = '';
      req.on('data', c => (corps += c));
      req.on('end', () => {
        const lignes = [].concat(JSON.parse(corps || '{}'));
        lignes.forEach(l => {
          const k = l[cleDe(table)];
          tables[table].set(k, { ...(tables[table].get(k) || {}), ...l });
        });
        envoyer(201, lignes);
      });
      return;
    }
    envoyer(405, {});
  });
  await new Promise(r => serveur.listen(0, r));

  process.env.SUPABASE_URL = `http://127.0.0.1:${serveur.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-de-test';
  process.env.SEL_EMPREINTE = 'sel-de-test';
  quota = await import('../api/_lib/quota.js');
});

after(() => serveur?.close());

const requete = (ip, ua = 'Mozilla/Test') => ({
  headers: { 'x-forwarded-for': ip, 'user-agent': ua, 'accept-language': 'fr' },
  socket: { remoteAddress: ip }
});

test('un visiteur anonyme obtient deux simulations puis est bloqué', async () => {
  const r = requete('1.2.3.4');

  let v = await quota.verifierQuota(r);
  assert.equal(v.autorise, true);
  assert.equal(v.restant, 2);
  await quota.consommerQuota(v);

  v = await quota.verifierQuota(r);
  assert.equal(v.autorise, true);
  assert.equal(v.restant, 1);
  await quota.consommerQuota(v);

  v = await quota.verifierQuota(r);
  assert.equal(v.autorise, false, 'la 3e simulation doit être refusée');
  assert.equal(v.code, 'quota');
  assert.match(v.motif, /Premium/);
});

test('les empreintes sont cloisonnées par IP et par navigateur', async () => {
  assert.equal((await quota.verifierQuota(requete('9.9.9.9'))).restant, 2);
  assert.equal((await quota.verifierQuota(requete('1.2.3.4', 'Autre/UA'))).restant, 2);
});

test('vérifier sans consommer ne décompte rien', async () => {
  // Une panne du modèle ne doit pas coûter une simulation au candidat.
  const r = requete('5.5.5.5');
  await quota.verifierQuota(r);
  await quota.verifierQuota(r);
  assert.equal((await quota.verifierQuota(r)).restant, 2);
});

test("l'empreinte ne contient aucune donnée en clair", async () => {
  const v = await quota.verifierQuota(requete('203.0.113.7', 'UA-Particulier'));
  assert.match(v.empreinte, /^[0-9a-f]{40}$/, 'condensé hexadécimal attendu');
  assert.ok(!v.empreinte.includes('203.0.113.7'));
});

test('consommerQuota ne fait rien pour un abonné premium', async () => {
  const avant = tables.usages.size;
  await quota.consommerQuota({ premium: true, utilisateurId: 'u-1', utilisees: 0 });
  assert.equal(tables.usages.size, avant, 'aucune écriture pour un premium');
});
