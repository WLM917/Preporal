/* ═══════════════════════════════════════════════════════════
   tests/webhook.test.mjs

   Le projet Supabase a été mis en pause pour inactivité : son
   adresse a disparu du DNS, et la base est devenue injoignable.

   Le client Supabase ne lève pas d'erreur dans ce cas, il rend
   un objet { error }. Le webhook l'ignorait et répondait « reçu »
   à Stripe — qui ne réessaie alors jamais. Un client débité
   pendant la panne ne recevait donc jamais son Premium, sans que
   personne le sache.

   Ce qui compte ici, c'est la réponse faite à Stripe : 500 tant
   que rien n'a été écrit, pour qu'il renvoie l'évènement de
   lui-même ; 200 seulement quand c'est fait.

   Stripe et Supabase sont remplacés par des doubles.
   ═══════════════════════════════════════════════════════════ */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { EventEmitter } from 'node:events';

process.env.STRIPE_SECRET_KEY = 'sk_test_double';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_double';
process.env.SUPABASE_URL = 'https://projet-en-pause.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle_de_service';
process.env.STRIPE_PRICE_MENSUEL = 'price_mensuel';
process.env.STRIPE_PRICE_EXTRA = 'price_extra';

const etat = globalThis.__double = {
  evenement: null,
  base: 'ok',          // 'ok' | 'injoignable'
  ecrits: [],          // profils réellement écrits
  profils: {}          // stripe_client_id → id
};

const STRIPE = 'data:text/javascript,' + encodeURIComponent(`
  export default class Stripe {
    constructor() {
      this.webhooks = { constructEvent: () => globalThis.__double.evenement };
    }
  }`);

/* Le double reproduit le comportement réel de postgrest-js : une base
   injoignable ne lève pas, elle rend { data: null, error }. */
const SUPABASE = 'data:text/javascript,' + encodeURIComponent(`
  const e = globalThis.__double;
  const panne = () => ({ data: null, error: { message: 'TypeError: fetch failed' }, status: 0 });
  export function createClient() {
    return {
      from: () => ({
        upsert: async ligne => {
          if (e.base !== 'ok') return panne();
          e.ecrits.push(ligne);
          return { data: null, error: null };
        },
        select: () => ({ eq: (_c, client) => ({ maybeSingle: async () => {
          if (e.base !== 'ok') return panne();
          const id = e.profils[client];
          return { data: id ? { id } : null, error: null };
        } }) })
      })
    };
  }`);

register('data:text/javascript,' + encodeURIComponent(`
  const STRIPE = ${JSON.stringify(STRIPE)};
  const SUPABASE = ${JSON.stringify(SUPABASE)};
  export async function resolve(specifier, context, suivant) {
    if (specifier === 'stripe') return { url: STRIPE, shortCircuit: true };
    if (specifier === '@supabase/supabase-js') return { url: SUPABASE, shortCircuit: true };
    return suivant(specifier, context);
  }`));

const { default: handler } = await import('../api/webhook.js');
const { majProfil, profilParClientStripe } = await import('../api/_lib/supabaseAdmin.js');

/** Livre un évènement au webhook comme Stripe le ferait. */
async function livrer(evenement) {
  etat.evenement = evenement;
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = { 'stripe-signature': 'sig' };
  let code = 0;
  const res = {
    status(c) { code = c; return this; },
    json() { return this; },
    end() { return this; }
  };
  const fin = handler(req, res);
  queueMicrotask(() => { req.emit('data', Buffer.from('{}')); req.emit('end'); });
  const avant = console.error;
  console.error = () => {};             // la panne est attendue ici
  try { await fin; } finally { console.error = avant; }
  return code;
}

const paiement = () => ({
  type: 'checkout.session.completed',
  data: { object: {
    client_reference_id: 'u1', mode: 'subscription', customer: 'cus_1',
    metadata: { plan: 'mensuel', utilisateur_id: 'u1' }
  } }
});

const changementDeFormule = () => ({
  type: 'customer.subscription.updated',
  data: { object: {
    status: 'active', customer: 'cus_1', current_period_end: 1800000000,
    metadata: {},                                  // pas d'identifiant : il faut chercher le profil
    items: { data: [{ price: { id: 'price_extra' } }] }
  } }
});

beforeEach(() => {
  etat.base = 'ok';
  etat.ecrits = [];
  etat.profils = { cus_1: 'u1' };
});


test('un paiement reçu pendant une panne de la base sera renvoyé par Stripe', async () => {
  etat.base = 'injoignable';
  const code = await livrer(paiement());
  assert.equal(code, 500,
    'répondre 200 sans avoir rien écrit ferait perdre le Premium du client pour de bon');
  assert.equal(etat.ecrits.length, 0);
});

test('quand la base revient, le même évènement aboutit', async () => {
  etat.base = 'injoignable';
  assert.equal(await livrer(paiement()), 500);

  // Stripe renvoie l'évènement ; cette fois la base répond.
  etat.base = 'ok';
  assert.equal(await livrer(paiement()), 200);
  assert.equal(etat.ecrits.length, 1);
  assert.equal(etat.ecrits[0].premium, true);
  assert.equal(etat.ecrits[0].plan, 'mensuel');
});

test('un changement de formule pendant la panne est lui aussi renvoyé', async () => {
  /* Ici le profil se cherche par le client Stripe : « je ne trouve
     personne » et « je ne peux pas demander » doivent rester deux
     réponses distinctes. */
  etat.base = 'injoignable';
  assert.equal(await livrer(changementDeFormule()), 500);

  etat.base = 'ok';
  assert.equal(await livrer(changementDeFormule()), 200);
  assert.equal(etat.ecrits[0].plan, 'extra');
});

test("majProfil lève quand l'écriture est refusée", async () => {
  etat.base = 'injoignable';
  await assert.rejects(() => majProfil('u1', { premium: true }), /Profil non mis à jour/);
});

test('un profil absent reste une réponse normale, pas une panne', async () => {
  assert.equal(await profilParClientStripe('cus_inconnu'), null);
  assert.deepEqual(await profilParClientStripe('cus_1'), { id: 'u1' });
  etat.base = 'injoignable';
  await assert.rejects(() => profilParClientStripe('cus_1'), /faute de base/);
});
