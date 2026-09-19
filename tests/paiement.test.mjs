/* ═══════════════════════════════════════════════════════════
   tests/paiement.test.mjs

   Deux choses se jouent à l'ouverture de la page de paiement :

   • la langue. Le site est traduit, mais Stripe Checkout ouvrait
     systématiquement en français — le candidat lisait sa page en
     anglais puis payait en français.

   • la cohérence entre le tarif configuré et le mode de l'offre.
     Un tarif ponctuel branché sur une offre déclarée « abonnement »
     fait répondre à Stripe « You specified `subscription` mode but
     the line items include a one-time price », message que rien ne
     relie à la variable d'environnement à corriger.

   Le SDK Stripe est remplacé par un double : ces tests ne doivent
   ni appeler le réseau ni exiger une clé.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

process.env.STRIPE_SECRET_KEY   = 'sk_test_double';
process.env.STRIPE_PRICE_EXTRA  = 'price_extra';
process.env.STRIPE_PRICE_PASS48 = 'price_pass48';
process.env.STRIPE_PRICE_MENSUEL = 'price_mensuel';

/* État partagé avec le double, qui vit dans un autre graphe de modules. */
let derniereSession = null;
globalThis.__stripeDouble = {
  typeDePrix: 'recurring',
  poser(s) { derniereSession = s; }
};

const DOUBLE = 'data:text/javascript,' + encodeURIComponent(`
  export default class Stripe {
    constructor() {
      this.checkout = { sessions: { create: async params => {
        globalThis.__stripeDouble.poser(params);
        const recurrent = globalThis.__stripeDouble.typeDePrix === 'recurring';
        if (params.mode === 'subscription' && !recurrent)
          throw new Error('You specified \\\`subscription\\\` mode but the line items include a one-time price.');
        if (params.mode === 'payment' && recurrent)
          throw new Error('You specified \\\`payment\\\` mode but the line items include a recurring price.');
        return { url: 'https://checkout.stripe.test/s', id: 'cs_1' };
      } } };
      this.prices = { retrieve: async () => ({
        recurring: globalThis.__stripeDouble.typeDePrix === 'recurring' ? { interval: 'month' } : null
      }) };
    }
  }`);

/* Le double renvoie un candidat AVEC une adresse : sans elle, un test qui
   vérifie que l'adresse ne part pas chez Stripe passerait même si le code
   la renvoyait, faute d'adresse à renvoyer. */
const SANS_SUPABASE = 'data:text/javascript,' + encodeURIComponent(`
  export const utilisateurDepuisJeton = async () => ({ id: 'u1', email: 'candidat@exemple.fr' });
  export const supabaseAdmin = () => null;`);

const CHARGEUR = 'data:text/javascript,' + encodeURIComponent(`
  const DOUBLE = ${JSON.stringify(DOUBLE)};
  const SANS_SUPABASE = ${JSON.stringify(SANS_SUPABASE)};
  export async function resolve(specifier, context, suivant) {
    if (specifier === 'stripe') return { url: DOUBLE, shortCircuit: true };
    if (specifier.endsWith('supabaseAdmin.js')) return { url: SANS_SUPABASE, shortCircuit: true };
    return suivant(specifier, context);
  }`);

register(CHARGEUR);

const { default: handler } = await import('../api/create-checkout-session.js');

const appeler = async body => {
  derniereSession = null;
  let code = 0, corps = null;
  const res = { status(c) { code = c; return this; }, json(j) { corps = j; return this; } };
  await handler({ method: 'POST', body, headers: { host: 'www.oralixia.com' } }, res);
  return { code, corps, session: derniereSession };
};

test('la page de paiement Stripe suit la langue choisie', async () => {
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  const cas = [['fr', 'fr'], ['en', 'en'], ['es', 'es'],
               ['de', 'auto'],        // langue que le site ne sert pas : au navigateur de décider
               [undefined, 'fr']];    // requête sans langue : le défaut du service
  for (const [langue, attendu] of cas) {
    const { code, session } = await appeler({ plan: 'extra', ...(langue ? { langue } : {}) });
    assert.equal(code, 200, `la session doit se créer pour « ${langue} »`);
    assert.equal(session.locale, attendu, `locale Stripe pour « ${langue} »`);
  }
});

test('un tarif ponctuel sur un abonnement nomme la variable à corriger', async () => {
  globalThis.__stripeDouble.typeDePrix = 'one_time';
  const { code, corps } = await appeler({ plan: 'extra', langue: 'fr' });
  assert.equal(code, 500);
  assert.match(corps.erreur, /STRIPE_PRICE_EXTRA/, "le message doit nommer la variable");
  assert.match(corps.erreur, /tarif récurrent/, 'il doit dire quoi créer');
  assert.ok(!/line items/.test(corps.erreur),
    'le message brut de Stripe ne doit pas remonter tel quel');
});

test('un tarif récurrent sur un paiement unique donne la consigne inverse', async () => {
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  const { code, corps } = await appeler({ plan: 'pass48', langue: 'fr' });
  assert.equal(code, 500);
  assert.match(corps.erreur, /STRIPE_PRICE_PASS48/);
  assert.match(corps.erreur, /tarif ponctuel/);
});

test("l'essai gratuit est demandé sur l'offre six mois, et sur elle seule", async () => {
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  const extra = await appeler({ plan: 'extra' });
  assert.equal(extra.session.subscription_data.trial_period_days, 7);

  const mensuel = await appeler({ plan: 'mensuel' });
  assert.equal(mensuel.session.subscription_data.trial_period_days, undefined,
    "l'abonnement mensuel n'a pas d'essai");
});

test("l'offre portée par la session est reprise dans ses métadonnées", async () => {
  /* Sans cela, le webhook ne sait pas quelle offre créditer. */
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  const { session } = await appeler({ plan: 'extra', userId: 'u1' });
  assert.equal(session.metadata.plan, 'extra');
  assert.equal(session.subscription_data.metadata.plan, 'extra');
  assert.equal(session.metadata.utilisateur_id, 'u1');
});

test("l'adresse n'est pas pré-remplie, pour que Link ne confisque pas la page", async () => {
  /* Stripe cherche l'adresse pré-remplie dans Link. Si le candidat y a un
     compte, Checkout s'ouvre sur une demande de code par SMS au lieu de la
     liste des moyens de paiement : ni carte, ni Apple Pay, ni Klarna. */
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  const { code, session } = await appeler({ plan: 'extra', userId: 'u1', langue: 'fr' });
  assert.equal(code, 200);
  assert.equal(session.customer_email, undefined,
    'pré-remplir l’adresse fait ouvrir Link à la place du choix du moyen de paiement');

  // Le rattachement au compte ne doit pas en dépendre.
  assert.equal(session.client_reference_id, 'u1',
    'le paiement se rattache au compte par client_reference_id');
});

test("le module d'offres n'envoie plus l'adresse à la création de session", () => {
  /* Le serveur ne la lit plus, mais la laisser partir du navigateur
     laisserait croire qu'elle sert encore. */
  const src = readFileSync(new URL('../js/paywall.js', import.meta.url), 'utf8');
  const appel = src.slice(src.indexOf('export async function lancerCheckout'),
                          src.indexOf('export async function ouvrirPortail'));
  assert.ok(!/email: session\.email/.test(appel),
    "lancerCheckout ne doit plus envoyer l'adresse");
  assert.match(appel, /userId: session\.id/, 'le compte doit toujours partir');
});

test("l'adresse de facturation n'écrase pas celle du compte", () => {
  /* Rien n'oblige à payer avec l'adresse avec laquelle on s'est inscrit.
     La recopier dans « profils » désynchronisait le miroir de
     l'authentification, qui seule fait foi. */
  const src = readFileSync(new URL('../api/webhook.js', import.meta.url), 'utf8');
  assert.ok(!/email: s\.customer_details\?\.email/.test(src),
    "le courriel saisi chez Stripe ne doit pas être écrit dans le profil");
});

test('quitter la page de paiement ramène là où on était', async () => {
  /* Le bouton de retour de Stripe ramenait toujours à l'accueil, même
     quand les offres avaient été ouvertes depuis « Mon espace ». */
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  const { session } = await appeler({ plan: 'extra', retour: '/compte.html' });
  assert.match(session.cancel_url, /\/compte\.html\?paiement=annule$/);
  assert.match(session.success_url, /\/compte\.html\?paiement=ok&plan=extra/);
});

test("un chemin de retour qui mène ailleurs est refusé", async () => {
  /* Le chemin vient du navigateur. « //ailleurs.fr » ressemble à un
     chemin absolu mais c'est une URL protocole-relative : elle mène
     hors du site. Un retour de paiement qui atterrit chez un tiers
     serait une porte ouverte à l'hameçonnage. */
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  for (const mauvais of ['//ailleurs.fr', 'https://ailleurs.fr', '/\\ailleurs.fr',
                         'compte.html', '', null, '/page#ancre', '/page avec espace']) {
    const { session } = await appeler({ plan: 'extra', retour: mauvais });
    for (const url of [session.cancel_url, session.success_url]) {
      assert.ok(!/ailleurs\.fr/.test(url), `« ${mauvais} » a traversé : ${url}`);
      assert.match(url, /^https:\/\/www\.oralixia\.com\//,
        `« ${mauvais} » doit retomber sur le site : ${url}`);
    }
  }
});

test('un chemin de retour qui porte déjà des paramètres reste valable', async () => {
  globalThis.__stripeDouble.typeDePrix = 'recurring';
  const { session } = await appeler({ plan: 'extra', retour: '/index.html?vue=compte' });
  assert.match(session.cancel_url, /\/index\.html\?vue=compte&paiement=annule$/,
    'le second paramètre doit être ajouté avec &, pas avec un deuxième ?');
});
