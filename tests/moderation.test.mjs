/* ═══════════════════════════════════════════════════════════
   tests/moderation.test.mjs

   La route de modération est la seule porte capable de rendre un
   avis public. Elle doit refuser tout ce qui n'est pas le jeton
   exact, et ne jamais fuiter d'information sur ce jeton.
   ═══════════════════════════════════════════════════════════ */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const JETON = 'jeton-de-modération-très-long-et-aléatoire-0123456789';
let avis = new Map();
let serveur, handler;

const reponseFactice = () => {
  const r = { code: 0, corps: null, entetes: {} };
  r.status = c => { r.code = c; return r; };
  r.json = o => { r.corps = o; return r; };
  r.setHeader = (k, v) => { r.entetes[k] = v; };
  r.end = () => r;
  return r;
};

before(async () => {
  serveur = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const envoyer = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!u.pathname.startsWith('/rest/v1/avis')) return envoyer(404, {});

    if (req.method === 'GET') {
      const f = u.searchParams.get('publie');
      const veutPublies = f === 'eq.true';
      return envoyer(200, [...avis.values()].filter(a => Boolean(a.publie) === veutPublies));
    }
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      let corps = '';
      req.on('data', c => (corps += c));
      req.on('end', () => {
        if (req.method === 'DELETE') avis.delete(id);
        else avis.set(id, { ...avis.get(id), ...JSON.parse(corps || '{}') });
        envoyer(200, []);
      });
      return;
    }
    envoyer(405, {});
  });
  await new Promise(r => serveur.listen(0, r));

  process.env.SUPABASE_URL = `http://127.0.0.1:${serveur.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-de-test';
  process.env.CLE_MODERATION = JETON;
  handler = (await import('../api/moderation.js')).default;
});

after(() => serveur?.close());

beforeEach(() => {
  avis = new Map([
    ['a1', { id: 'a1', nom: 'Camille', statut: 'L3', note: 4, texte: 'Utile.', publie: false, cree_le: '2026-01-01T00:00:00Z' }],
    ['a2', { id: 'a2', nom: 'Sofiane', statut: 'Terminale', note: 5, texte: 'Très bien.', publie: true, cree_le: '2026-01-02T00:00:00Z' }]
  ]);
});

const requete = (methode, jeton, corps = null, query = {}) => ({
  method: methode,
  headers: jeton ? { authorization: 'Bearer ' + jeton } : {},
  query, body: corps
});

test('sans jeton, la route refuse', async () => {
  const r = reponseFactice();
  await handler(requete('GET', null), r);
  assert.equal(r.code, 401);
});

test('un mauvais jeton refuse', async () => {
  const r = reponseFactice();
  await handler(requete('GET', 'mauvais-jeton'), r);
  assert.equal(r.code, 401);
});

test('un jeton de longueur différente ne fait pas planter la comparaison', async () => {
  // timingSafeEqual lève si les longueurs diffèrent : le code doit le gérer.
  const r = reponseFactice();
  await handler(requete('GET', 'x'), r);
  assert.equal(r.code, 401);
});

test('le bon jeton liste les avis en attente', async () => {
  const r = reponseFactice();
  await handler(requete('GET', JETON, null, { etat: 'attente' }), r);
  assert.equal(r.code, 200);
  assert.equal(r.corps.avis.length, 1);
  assert.equal(r.corps.avis[0].id, 'a1');
});

test('publier un avis le rend visible', async () => {
  const r = reponseFactice();
  await handler(requete('POST', JETON, { id: 'a1', action: 'publier' }), r);
  assert.equal(r.code, 200);
  assert.equal(avis.get('a1').publie, true);
});

test('rejeter un avis le supprime', async () => {
  const r = reponseFactice();
  await handler(requete('POST', JETON, { id: 'a1', action: 'rejeter' }), r);
  assert.equal(r.code, 200);
  assert.equal(avis.has('a1'), false, 'un avis rejeté ne doit pas être conservé');
});

test('une action inconnue est rejetée', async () => {
  const r = reponseFactice();
  await handler(requete('POST', JETON, { id: 'a1', action: 'tout_publier' }), r);
  assert.equal(r.code, 400);
  assert.equal(avis.get('a1').publie, false);
});

test('la réponse ne renvoie jamais le jeton attendu', async () => {
  const r = reponseFactice();
  await handler(requete('GET', 'mauvais'), r);
  assert.ok(!JSON.stringify(r.corps).includes(JETON));
});

test('les réponses ne sont pas mises en cache', async () => {
  const r = reponseFactice();
  await handler(requete('GET', JETON, null, { etat: 'attente' }), r);
  assert.equal(r.entetes['Cache-Control'], 'no-store');
});
