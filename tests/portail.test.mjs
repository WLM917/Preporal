/* ═══════════════════════════════════════════════════════════
   tests/portail.test.mjs

   « Résilier ou changer de formule » menait à un portail Stripe
   qui ne proposait que de résilier. Il était ouvert sans
   configuration : Stripe appliquait celle par défaut, où
   l'échange de formules est désactivé — alors que les CGV
   promettaient de pouvoir passer d'une formule à l'autre.

   En y regardant, deux choses plus graves :

   • sans jeton de connexion, l'endpoint cherchait le client
     Stripe avec l'adresse envoyée dans la requête. N'importe qui
     ouvrait le portail de n'importe quel abonné dont il
     connaissait l'e-mail — factures, adresse, carte, résiliation ;

   • après un changement de formule, le webhook lisait l'étiquette
     posée au paiement avant le tarif réel : l'abonné passé à six
     mois restait « mensuel » sur sa page de compte.

   Le SDK Stripe et Supabase sont remplacés par des doubles : ni
   réseau, ni clé.
   ═══════════════════════════════════════════════════════════ */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

process.env.STRIPE_SECRET_KEY    = 'sk_test_double';
process.env.STRIPE_PRICE_MENSUEL = 'price_mensuel';
process.env.STRIPE_PRICE_EXTRA   = 'price_extra';
process.env.STRIPE_PRICE_PASS48  = 'price_pass48';
delete process.env.URL_PUBLIQUE;

/* État partagé avec les doubles, qui vivent dans un autre graphe de modules. */
const etat = globalThis.__double = {
  configurations: [],       // ce que Stripe « possède » déjà
  creees: [],               // configurations créées pendant le test
  sessions: [],             // sessions de portail ouvertes
  recherches: [],           // adresses cherchées chez Stripe
  lectures: 0,              // appels à configurations.list
  prix: {
    price_mensuel: { id: 'price_mensuel', product: 'prod_premium', recurring: { interval: 'month' } },
    price_extra:   { id: 'price_extra',   product: 'prod_premium', recurring: { interval: 'month', interval_count: 6 } },
    price_pass48:  { id: 'price_pass48',  product: 'prod_pass',    recurring: null }
  },
  clientsParEmail: { 'abonne@exemple.fr': 'cus_abonne', 'victime@exemple.fr': 'cus_victime' },
  clientEnBase: null,       // stripe_client_id du profil
  echecConfiguration: null  // message d'erreur à lever à la création
};

const STRIPE = 'data:text/javascript,' + encodeURIComponent(`
  const e = globalThis.__double;
  export default class Stripe {
    constructor() {
      this.billingPortal = {
        configurations: {
          list: async () => { e.lectures++; return { data: e.configurations }; },
          create: async params => {
            if (e.echecConfiguration) throw new Error(e.echecConfiguration);
            e.creees.push(params);
            const c = { id: 'bpc_' + e.creees.length, metadata: params.metadata };
            e.configurations.push(c);
            return c;
          }
        },
        sessions: { create: async params => {
          e.sessions.push(params);
          return { url: 'https://billing.stripe.test/p/session' };
        } }
      };
      this.prices = { retrieve: async id => e.prix[id] };
      this.customers = { list: async ({ email }) => {
        e.recherches.push(email);
        const id = e.clientsParEmail[email];
        return { data: id ? [{ id }] : [] };
      } };
    }
  }`);

const SUPABASE = 'data:text/javascript,' + encodeURIComponent(`
  const e = globalThis.__double;
  export const utilisateurDepuisJeton = async req =>
    req.headers.authorization === 'Bearer bon'
      ? { id: 'u1', email: 'abonne@exemple.fr' } : null;
  export const supabaseAdmin = () => ({
    from: () => ({ select: () => ({ eq: () => ({
      maybeSingle: async () => ({ data: { stripe_client_id: e.clientEnBase } })
    }) }) })
  });`);

const CHARGEUR = 'data:text/javascript,' + encodeURIComponent(`
  const STRIPE = ${JSON.stringify(STRIPE)};
  const SUPABASE = ${JSON.stringify(SUPABASE)};
  export async function resolve(specifier, context, suivant) {
    if (specifier === 'stripe') return { url: STRIPE, shortCircuit: true };
    if (specifier.endsWith('supabaseAdmin.js')) return { url: SUPABASE, shortCircuit: true };
    return suivant(specifier, context);
  }`);
register(CHARGEUR);

const { default: handler } = await import('../api/create-portal-session.js');
const { oublierConfiguration, produitsPourPortail, formulesEchangeables } =
  await import('../api/_lib/portail.js');
const { planDeLAbonnement } = await import('../api/_lib/plans.js');

const ouvrir = async ({ jeton = 'bon', body = {}, host = 'www.oralixia.com' } = {}) => {
  let code = 0, corps = null;
  const res = { status(c) { code = c; return this; }, json(j) { corps = j; return this; } };
  const headers = { host, ...(jeton ? { authorization: 'Bearer ' + jeton } : {}) };
  await handler({ method: 'POST', body, headers }, res);
  return { code, corps };
};

beforeEach(() => {
  oublierConfiguration();
  etat.configurations = [];
  etat.creees = [];
  etat.sessions = [];
  etat.recherches = [];
  etat.lectures = 0;
  etat.clientEnBase = null;
  etat.echecConfiguration = null;
});


/* ── Le portail ne s'ouvre qu'à son titulaire ───────────────── */

test("sans connexion, le portail ne s'ouvre pour personne", async () => {
  const r = await ouvrir({ jeton: null, body: { email: 'victime@exemple.fr' } });
  assert.equal(r.code, 401);
  assert.equal(etat.sessions.length, 0,
    "aucune session de portail ne doit être créée pour un inconnu");
  assert.deepEqual(etat.recherches, [],
    "l'adresse envoyée par un inconnu ne doit même pas être cherchée chez Stripe");
});

test("un jeton invalide ne vaut pas mieux qu'une absence de jeton", async () => {
  const r = await ouvrir({ jeton: 'faux', body: { email: 'victime@exemple.fr' } });
  assert.equal(r.code, 401);
  assert.equal(etat.sessions.length, 0);
});

test("connecté, on ouvre SON portail — jamais celui de l'adresse envoyée", async () => {
  /* Le cas qui compte : un abonné connecté qui envoie l'adresse d'un
     autre. Seule l'adresse vérifiée par l'authentification sert. */
  const r = await ouvrir({ body: { email: 'victime@exemple.fr' } });
  assert.equal(r.code, 200);
  assert.deepEqual(etat.recherches, ['abonne@exemple.fr']);
  assert.equal(etat.sessions[0].customer, 'cus_abonne');
});

test("l'identifiant client enregistré au paiement passe avant toute recherche", async () => {
  etat.clientEnBase = 'cus_enregistre';
  await ouvrir();
  assert.equal(etat.sessions[0].customer, 'cus_enregistre');
  assert.deepEqual(etat.recherches, [], 'rien à chercher quand le compte connaît déjà son client');
});


/* ── Les deux abonnements s'échangent ───────────────────────── */

test("le portail s'ouvre avec l'échange de formules activé", async () => {
  await ouvrir();
  assert.equal(etat.creees.length, 1, 'une configuration doit être créée');
  assert.equal(etat.sessions[0].configuration, 'bpc_1',
    'et la session doit s\'en servir — sinon Stripe applique la sienne, sans échange');

  const maj = etat.creees[0].features.subscription_update;
  assert.equal(maj.enabled, true);
  assert.deepEqual(maj.default_allowed_updates, ['price']);
  const tarifs = maj.products.flatMap(p => p.prices).sort();
  assert.deepEqual(tarifs, ['price_extra', 'price_mensuel'],
    "l'offre mensuelle et l'offre six mois doivent pouvoir s'échanger");
});

test("le Pass 48 heures n'est jamais proposé en échange d'un abonnement", async () => {
  /* Paiement unique : Stripe n'échange qu'un tarif récurrent contre un
     autre. L'envoyer ferait refuser toute la configuration. */
  await ouvrir();
  const tarifs = etat.creees[0].features.subscription_update.products.flatMap(p => p.prices);
  assert.ok(!tarifs.includes('price_pass48'));
  assert.deepEqual(formulesEchangeables().map(f => f.cle).sort(), ['extra', 'mensuel']);
});

test("deux tarifs d'un même produit arrivent ensemble", () => {
  /* Stripe refuse qu'un produit apparaisse deux fois dans la liste. */
  const produits = produitsPourPortail([
    { id: 'price_a', product: 'prod_1', recurring: {} },
    { id: 'price_b', product: 'prod_1', recurring: {} },
    { id: 'price_c', product: { id: 'prod_2' }, recurring: {} },
    { id: 'price_d', product: 'prod_3', recurring: null }
  ]);
  assert.deepEqual(produits, [
    { product: 'prod_1', prices: ['price_a', 'price_b'] },
    { product: 'prod_2', prices: ['price_c'] }
  ]);
});

test('la résiliation garde les termes des CGV : fin de période, sans prorata', async () => {
  await ouvrir();
  const annulation = etat.creees[0].features.subscription_cancel;
  assert.equal(annulation.enabled, true);
  assert.equal(annulation.mode, 'at_period_end',
    "« la résiliation prend effet à la fin de la période déjà réglée »");
  assert.equal(annulation.proration_behavior, 'none', "« aucun prorata n'est remboursé »");

  const f = etat.creees[0].features;
  assert.equal(f.payment_method_update.enabled, true, 'changer de carte reste possible');
  assert.equal(f.invoice_history.enabled, true, 'les factures restent consultables');
  assert.equal(f.subscription_update.proration_behavior, 'create_prorations',
    'la part non utilisée doit être créditée, comme les CGV l\'annoncent');
});

test("la configuration n'est créée qu'une fois", async () => {
  await ouvrir();
  await ouvrir();
  assert.equal(etat.creees.length, 1, 'jamais deux fois la même');
  /* Ne pas la recréer ne suffit pas : la chercher chez Stripe à chaque
     ouverture du portail serait un aller-retour de trop. La même
     instance la garde en mémoire. */
  assert.equal(etat.lectures, 1, 'la deuxième ouverture ne doit plus interroger Stripe');

  // Une nouvelle instance la retrouve chez Stripe par sa signature.
  oublierConfiguration();
  await ouvrir();
  assert.equal(etat.creees.length, 1, 'une instance neuve ne doit pas en recréer une');
  assert.equal(etat.sessions[2].configuration, 'bpc_1');
});

test('un changement de tarif produit une nouvelle configuration', async () => {
  await ouvrir();
  process.env.STRIPE_PRICE_EXTRA = 'price_extra_v2';
  etat.prix.price_extra_v2 = { id: 'price_extra_v2', product: 'prod_premium', recurring: {} };
  oublierConfiguration();
  try {
    await ouvrir();
    assert.equal(etat.creees.length, 2,
      "l'ancienne échangerait encore l'ancien tarif : il en faut une nouvelle");
    const tarifs = etat.creees[1].features.subscription_update.products.flatMap(p => p.prices);
    assert.ok(tarifs.includes('price_extra_v2'));
  } finally {
    process.env.STRIPE_PRICE_EXTRA = 'price_extra';
  }
});

test("si la configuration échoue, le portail s'ouvre quand même", async () => {
  /* Résilier, changer de carte, lire ses factures : on n'en prive
     personne parce que l'échange de formules n'a pas pu être préparé. */
  etat.echecConfiguration = 'This API key does not have access to billing_portal';
  const erreurs = [];
  const avant = console.error;
  console.error = (...a) => erreurs.push(a.join(' '));
  try {
    const r = await ouvrir();
    assert.equal(r.code, 200);
    assert.equal(etat.sessions.length, 1);
    assert.equal(etat.sessions[0].configuration, undefined,
      'sans configuration, on laisse Stripe appliquer la sienne');
    assert.ok(erreurs.some(e => /portail/i.test(e)), "l'échec doit se lire dans les journaux");
  } finally {
    console.error = avant;
  }
});

test('avec un seul abonnement configuré, rien ne se crée', async () => {
  const extra = process.env.STRIPE_PRICE_EXTRA;
  delete process.env.STRIPE_PRICE_EXTRA;
  try {
    await ouvrir();
    assert.equal(etat.creees.length, 0, 'un échange suppose deux formules');
    assert.equal(etat.sessions[0].configuration, undefined);
    assert.equal(etat.lectures, 0,
      "avec une seule formule, il n'y a rien à préparer : inutile d'interroger Stripe");
  } finally {
    process.env.STRIPE_PRICE_EXTRA = extra;
  }
});


/* ── Ce que la configuration affiche ─────────────────────────── */

test('les liens légaux du portail ne viennent jamais du corps de la requête', async () => {
  /* La configuration est partagée par tous les abonnés : une adresse
     glissée dans la requête d'un seul se retrouverait sous les yeux
     de tous. */
  await ouvrir({ body: { origine: 'https://piege.example' } });
  const profil = etat.creees[0].business_profile;
  assert.equal(profil.terms_of_service_url, 'https://www.oralixia.com/?legal=cgv');
  assert.equal(profil.privacy_policy_url, 'https://www.oralixia.com/?legal=confidentialite');
  assert.ok(!JSON.stringify(etat.sessions[0]).includes('piege'),
    'le retour vers le site ne doit pas non plus suivre une adresse fournie');
});

test('le portail suit la langue du site', async () => {
  for (const [langue, attendue] of [['fr', 'fr'], ['en', 'en'], ['es', 'es'], ['de', 'auto'], [undefined, 'auto']]) {
    etat.sessions = [];
    await ouvrir({ body: { langue } });
    assert.equal(etat.sessions[0].locale, attendue, `langue « ${langue} »`);
  }
});


/* ── Le webhook suit le tarif, pas l'étiquette du paiement ───── */

test("après un changement de formule, l'offre se lit sur le tarif", () => {
  /* Les métadonnées sont posées au paiement et ne bougent plus. Le
     portail change le tarif : c'est lui qui dit la vérité. */
  const passeASixMois = {
    metadata: { plan: 'mensuel', utilisateur_id: 'u1' },
    items: { data: [{ price: { id: 'price_extra' } }] }
  };
  assert.equal(planDeLAbonnement(passeASixMois), 'extra');

  const revenuAuMois = {
    metadata: { plan: 'extra' },
    items: { data: [{ price: { id: 'price_mensuel' } }] }
  };
  assert.equal(planDeLAbonnement(revenuAuMois), 'mensuel');
});

test("l'étiquette du paiement ne sert plus que de repli", () => {
  const tarifInconnu = { metadata: { plan: 'extra' }, items: { data: [{ price: { id: 'price_autre' } }] } };
  assert.equal(planDeLAbonnement(tarifInconnu), 'extra');
  assert.equal(planDeLAbonnement({ metadata: { plan: 'inventee' } }), null);
  assert.equal(planDeLAbonnement(null), null);
});


/* ── Le site ────────────────────────────────────────────────── */

test("le navigateur n'envoie plus ni identifiant ni adresse au portail", () => {
  const pw = readFileSync(new URL('../js/paywall.js', import.meta.url), 'utf8');
  const debut = pw.indexOf('export async function ouvrirPortail');
  const corps = pw.slice(debut, pw.indexOf('\n}', debut));
  assert.match(corps, /body: JSON\.stringify\(\{ langue: langue\(\) \}\)/,
    'seule la langue part : le serveur lit le compte dans le jeton');
  assert.doesNotMatch(corps, /session\.email|userId|origine/);
});

test("« ?legal=cgv » ouvre les CGV, et seulement un texte connu", () => {
  const src = readFileSync(new URL('../js/legal.js', import.meta.url), 'utf8');
  assert.match(src, /searchParams\.get\('legal'\)/, 'le lien du portail doit ouvrir le texte');
  assert.match(src, /Object\.hasOwn\(textes\(\), demande\)/,
    'un nom arbitraire — « __proto__ », « constructor » — ne doit rien ouvrir');
});

test("un détenteur du Pass 48 heures ne se voit pas proposer de résilier", () => {
  const src = readFileSync(new URL('../js/compte.js', import.meta.url), 'utf8');
  const branche = src.slice(src.indexOf("profil.plan === 'pass48' ?"));
  assert.ok(branche.length > 0, "le pass doit avoir sa propre carte");
  const sienne = branche.slice(0, branche.indexOf('` : `'));
  assert.match(sienne, /data-action="offres"/, 'on lui propose de passer à un abonnement');
  assert.doesNotMatch(sienne, /data-action="portail"/,
    "le portail n'a rien à lui résilier");
});

test('les CGV disent comment un changement de formule est facturé', async () => {
  const src = readFileSync(new URL('../js/legal.js', import.meta.url), 'utf8');
  assert.match(src, /cgv\.4_changement/);
  const texte = src.slice(src.indexOf("pa('cgv.4_changement'"), src.indexOf("pa('cgv.4_changement'") + 500);
  assert.match(texte, /immédiatement/, "l'effet immédiat doit être annoncé");
  assert.match(texte, /crédit/, 'le sort de la période non utilisée aussi');
  for (const langue of ['en', 'es']) {
    const dico = readFileSync(new URL(`../js/langues/${langue}.js`, import.meta.url), 'utf8');
    for (const cle of ['legal.cgv.4_changement', 'compte.changement_aide', 'compte.pass_ponctuel',
                       'compte.passer_abonnement', 'compte.pass_aide']) {
      assert.ok(dico.includes(`"${cle}"`), `${langue} : « ${cle} » manque`);
    }
  }
});

test('la période de la formule suit la langue sur la page de compte', () => {
  /* La carte écrivait « par mois » en toutes langues : la modale d'offre
     traduisait la période, la page de compte non. */
  const src = readFileSync(new URL('../js/compte.js', import.meta.url), 'utf8');
  const carte = src.slice(src.indexOf('function rendreAbonnement'));
  assert.match(carte.slice(0, 2500), /t\('offre\.periode\.' \+ offre\.periode/,
    'la période doit passer par le dictionnaire');
  assert.doesNotMatch(carte.slice(0, 2500), /echappe\(offre\.periode\)\}/,
    'et non s\'afficher brute');
});
