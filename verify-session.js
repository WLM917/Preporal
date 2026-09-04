// api/verify-session.js — confirme côté serveur qu'une session Stripe est payée.
// Le navigateur ne décide jamais seul qu'il a payé : il présente un session_id,
// le serveur interroge Stripe.

import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const id = req.query.session_id;
  if (!id) return res.status(400).json({ error: 'Session absente.' });

  try {
    const s = await stripe.checkout.sessions.retrieve(id);
    const paid = s.payment_status === 'paid' || s.status === 'complete';
    return res.status(200).json({
      paid,
      plan: s.metadata?.plan || 'pack',
      credits: Number(s.metadata?.credits || 3)
    });
  } catch (e) {
    console.error('verify:', e);
    return res.status(400).json({ paid: false, error: 'Session introuvable.' });
  }
}
