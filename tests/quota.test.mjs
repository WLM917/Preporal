/* ═══════════════════════════════════════════════════════════
   tests/quota.test.mjs

   Le quota des simulations gratuites est la seule chose qui
   sépare le service d'une facture de modèle illimitée. Il est
   donc testé contre un faux serveur REST Supabase, avec le vrai
   client supabase-js.

   Deux régimes coexistent : compte obligatoire (le défaut) et
   quota anonyme par empreinte (EXIGER_CONNEXION=false). Le
   module lit la variable au chargement : le second régime est
   donc importé sous une autre URL pour obtenir une instance
   distincte.
   ═══════════════════════════════════════════════════════════ */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const tables = { profils: new Map(), usages: new Map(), usages_anonymes: new Map() };
const cleDe = t => (t === 'usages_anonymes' ? 'empreinte' : t === 'usages' ? 'utilisateur_id' : 'id');

let serveur, quota, quotaAnonyme;

/* Jeton reconnu par le faux serveur d'authentification. */
const JETON = 'jeton-de-test';
const UTILISATEUR = { id: 'u-inscrit', email: 'candidat@exemple.fr' };

before(async () => {
  serveur = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const table = u.pathname.replace('/rest/v1/', '');
    const envoyer = (code, corps) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corps));
    };
    if (u.pathname === '/auth/v1/user') {
      return (req.headers.authorization || '').endsWith(JETON)
        ? envoyer(200, UTILISATEUR)
        : envoyer(401, { message: 'pas de session' });
    }
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

  // Régime par défaut : un compte est exigé.
  delete process.env.EXIGER_CONNEXION;
  quota = await import('../api/_lib/quota.js');

  // Régime de repli, explicitement désactivé : quota anonyme par empreinte.
  process.env.EXIGER_CONNEXION = 'false';
  quotaAnonyme = await import('../api/_lib/quota.js?anonyme');
  delete process.env.EXIGER_CONNEXION;
});

after(() => serveur?.close());

const requete = (ip, ua = 'Mozilla/Test') => ({
  headers: { 'x-forwarded-for': ip, 'user-agent': ua, 'accept-language': 'fr' },
  socket: { remoteAddress: ip }
});

/** Même requête, mais porteuse d'une session valide. */
const requeteConnectee = (ip = '10.0.0.1') => {
  const r = requete(ip);
  r.headers.authorization = 'Bearer ' + JETON;
  return r;
};

test('sans compte, la simulation est refusée', async () => {
  /* C'est tout l'objet du réglage par défaut : le quota anonyme se
     remettait à zéro en vidant son navigateur, ce qui rendait les
     deux simulations offertes infiniment renouvelables. */
  const v = await quota.verifierQuota(requete('4.4.4.4'));
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'connexion');
  assert.equal(v.empreinte, null, 'aucune empreinte à conserver si tout est refusé');
  assert.match(v.motif, /compte/i);
});

test('un compte ouvre bien deux simulations, puis le paywall', async () => {
  const r = requeteConnectee();

  let v = await quota.verifierQuota(r);
  assert.equal(v.utilisateurId, UTILISATEUR.id, 'le quota doit être rattaché au compte');
  assert.equal(v.restant, 2, 'deux simulations offertes à la création du compte');
  await quota.consommerQuota(v);

  v = await quota.verifierQuota(r);
  assert.equal(v.restant, 1);
  await quota.consommerQuota(v);

  v = await quota.verifierQuota(r);
  assert.equal(v.autorise, false, 'la 3e simulation doit être refusée');
  assert.equal(v.code, 'quota');
});

test('le compte suit le candidat, pas le navigateur', async () => {
  /* Changer d'IP ou de navigateur ne redonne pas de simulations :
     le compteur est indexé sur l'identifiant du compte. */
  const ailleurs = requeteConnectee('198.51.100.9');
  ailleurs.headers['user-agent'] = 'Autre/Navigateur';
  const v = await quota.verifierQuota(ailleurs);
  assert.equal(v.autorise, false, 'le quota du compte reste épuisé');
  assert.equal(v.code, 'quota');
});

test('EXIGER_CONNEXION=false : le visiteur anonyme garde deux simulations', async () => {
  const r = requete('1.2.3.4');

  let v = await quotaAnonyme.verifierQuota(r);
  assert.equal(v.autorise, true);
  assert.equal(v.restant, 2);
  await quotaAnonyme.consommerQuota(v);

  v = await quotaAnonyme.verifierQuota(r);
  assert.equal(v.autorise, true);
  assert.equal(v.restant, 1);
  await quotaAnonyme.consommerQuota(v);

  v = await quotaAnonyme.verifierQuota(r);
  assert.equal(v.autorise, false, 'la 3e simulation doit être refusée');
  assert.equal(v.code, 'quota');
  assert.match(v.motif, /Premium/);
});

test('EXIGER_CONNEXION=false : les empreintes sont cloisonnées par IP et par navigateur', async () => {
  assert.equal((await quotaAnonyme.verifierQuota(requete('9.9.9.9'))).restant, 2);
  assert.equal((await quotaAnonyme.verifierQuota(requete('1.2.3.4', 'Autre/UA'))).restant, 2);
});

test('EXIGER_CONNEXION=false : vérifier sans consommer ne décompte rien', async () => {
  // Une panne du modèle ne doit pas coûter une simulation au candidat.
  const r = requete('5.5.5.5');
  await quotaAnonyme.verifierQuota(r);
  await quotaAnonyme.verifierQuota(r);
  assert.equal((await quotaAnonyme.verifierQuota(r)).restant, 2);
});

test("EXIGER_CONNEXION=false : l'empreinte ne contient aucune donnée en clair", async () => {
  const v = await quotaAnonyme.verifierQuota(requete('203.0.113.7', 'UA-Particulier'));
  assert.match(v.empreinte, /^[0-9a-f]{40}$/, 'condensé hexadécimal attendu');
  assert.ok(!v.empreinte.includes('203.0.113.7'));
});

test('consommerQuota ne fait rien pour un abonné premium', async () => {
  const avant = tables.usages.size;
  await quota.consommerQuota({ premium: true, utilisateurId: 'u-1', utilisees: 0 });
  assert.equal(tables.usages.size, avant, 'aucune écriture pour un premium');
});
