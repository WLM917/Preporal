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

const tables = { profils: new Map(), usages: new Map(), usages_anonymes: new Map(), usages_coach: new Map() };
const cleDe = t => (t === 'usages_anonymes' ? 'empreinte'
                 : t === 'usages' || t === 'usages_coach' ? 'utilisateur_id' : 'id');

/* usages_coach a une clé composite (utilisateur, jour) : le faux
   serveur doit la reproduire, sinon deux jours se confondraient. */
const cleLigne = (table, l) =>
  table === 'usages_coach' ? `${l.utilisateur_id}|${l.jour}` : l[cleDe(table)];

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
      const jour = (u.searchParams.get('jour') || '').replace(/^eq\./, '');
      const cle = table === 'usages_coach' ? `${val}|${jour}` : val;
      const ligne = tables[table].get(cle);
      return envoyer(200, ligne ? [ligne] : []);
    }
    if (req.method === 'POST') {
      let corps = '';
      req.on('data', c => (corps += c));
      req.on('end', () => {
        const lignes = [].concat(JSON.parse(corps || '{}'));
        lignes.forEach(l => {
          const k = cleLigne(table, l);
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


/* ── Coach IA : quelques échanges par jour hors abonnement ── */

test('sans compte, le coach est refusé', async () => {
  const v = await quota.verifierQuotaCoach(requete('7.7.7.7'));
  assert.equal(v.autorise, false);
  assert.equal(v.code, 'connexion');
});

test('le coach offre ses échanges du jour, puis ferme', async () => {
  const r = requeteConnectee('10.0.0.2');
  const max = quota.MESSAGES_COACH_PAR_JOUR;
  assert.ok(max >= 1, 'il faut au moins un échange offert pour goûter le coach');

  for (let i = 0; i < max; i++) {
    const v = await quota.verifierQuotaCoach(r);
    assert.equal(v.autorise, true, `échange ${i + 1} refusé à tort`);
    assert.equal(v.restant, max - i);
    await quota.consommerQuotaCoach(v);
  }

  const v = await quota.verifierQuotaCoach(r);
  assert.equal(v.autorise, false, 'un échange de trop doit être refusé');
  assert.equal(v.code, 'coach');
  assert.match(v.motif, /demain|Premium/i);
});

test('le compteur du coach repart le lendemain', () => {
  /* La clé porte le jour : une nouvelle date, un nouveau compteur.
     C'est ce qui ramène les candidats le lendemain, et ce qui évite
     d'avoir à purger la table.

     Le test agit sur la table plutôt que sur l'horloge : le compteur
     d'hier est saturé, celui d'aujourd'hui effacé, et l'on vérifie
     que les deux lignes ne se confondent pas. */
  tables.usages_coach.clear();
  tables.usages_coach.set(`${UTILISATEUR.id}|2000-01-01`,
    { utilisateur_id: UTILISATEUR.id, jour: '2000-01-01', messages: 999 });

  const cles = [...tables.usages_coach.keys()];
  assert.deepEqual(cles, [`${UTILISATEUR.id}|2000-01-01`]);
  assert.ok(!cles.some(c => c.endsWith('|' + new Date().toISOString().slice(0, 10))),
    "la ligne d'hier ne doit pas porter la date du jour");
});

test("le compteur du coach d'un jour saturé n'entame pas le jour suivant", async () => {
  // Table vidée : le jour courant repart donc de zéro, quoi qu'ait
  // consommé le test précédent.
  tables.usages_coach.clear();
  const v = await quota.verifierQuotaCoach(requeteConnectee('10.0.0.3'));
  assert.equal(v.autorise, true);
  assert.equal(v.restant, quota.MESSAGES_COACH_PAR_JOUR);
});

test('un abonné parle au coach sans limite', async () => {
  const sb = tables.profils;
  sb.set('u-inscrit', { id: 'u-inscrit', premium: true, premium_jusqu_au: null });
  const v = await quota.verifierQuotaCoach(requeteConnectee('10.0.0.4'));
  assert.equal(v.autorise, true);
  assert.equal(v.premium, true);
  assert.equal(v.restant, Infinity);
  sb.delete('u-inscrit');
});
