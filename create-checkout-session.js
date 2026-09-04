// api/create-checkout-session.js — crée la session Stripe Checkout
// npm i stripe

import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  pack: { price: process.env.STRIPE_PRICE_PACK, mode: 'payment',      credits: 3 },
  sub:  { price: process.env.STRIPE_PRICE_SUB,  mode: 'subscription', credits: 0 }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const plan = PLANS[req.body?.plan];
  if (!plan) return res.status(400).json({ error: 'Formule inconnue.' });

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: plan.mode,
      line_items: [{ price: plan.price, quantity: 1 }],
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      locale: 'fr',
      metadata: { plan: req.body.plan, credits: String(plan.credits) },
      allow_promotion_codes: true
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('checkout:', e);
    return res.status(500).json({ error: 'Stripe a refusé la création de la session.' });
  }
}
