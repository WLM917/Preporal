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

const SANS_SUPABASE = 'data:text/javascript,' + encodeURIComponent(`
  export const utilisateurDepuisJeton = async () => null;
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
