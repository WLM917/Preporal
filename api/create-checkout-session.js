/* ═══════════════════════════════════════════════════════════
   POST /api/create-checkout-session
   Entrée : { plan: 'mensuel' | 'pass48', email?, userId?, origine? }
   Sortie : { url }  → le navigateur est redirigé vers Stripe
   ═══════════════════════════════════════════════════════════ */

import Stripe from 'stripe';
import { utilisateurDepuisJeton } from './_lib/supabaseAdmin.js';

const PLANS = {
  mensuel: { env: 'STRIPE_PRICE_MENSUEL', mode: 'subscription', nom: 'PrepOral Premium' },
  pass48:  { env: 'STRIPE_PRICE_PASS48',  mode: 'payment',      nom: 'Pass 48 heures' },
  // Paiement unique couvrant six mois : ce n'est pas un abonnement,
  // rien n'est reconduit et l'échéance est posée par le webhook.
  extra:   { env: 'STRIPE_PRICE_EXTRA',   mode: 'payment',      nom: 'PrepOral Extra' }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'Méthode non autorisée.' });

  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return res.status(500).json({ erreur: "Stripe n'est pas configuré (STRIPE_SECRET_KEY manquante)." });

  try {
    const stripe = new Stripe(cle, { apiVersion: '2024-06-20' });
    const { plan = 'mensuel', email, userId, origine } = req.body || {};

    const config = PLANS[plan];
    if (!config) return res.status(400).json({ erreur: 'Offre inconnue.' });

    const priceId = process.env[config.env];
    if (!priceId) return res.status(500).json({ erreur: `Tarif Stripe manquant (${config.env}).` });

    // Si l'utilisateur est authentifié, on relie le paiement à son compte.
    const utilisateur = await utilisateurDepuisJeton(req);
    const identifiant = utilisateur?.id || userId || null;
    const courriel = utilisateur?.email || email || undefined;

    const base = process.env.URL_PUBLIQUE || origine || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: config.mode,
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: courriel,
      client_reference_id: identifiant || undefined,
      metadata: { plan, utilisateur_id: identifiant || '' },
      ...(config.mode === 'subscription'
        ? { subscription_data: { metadata: { plan, utilisateur_id: identifiant || '' } } }
        : { payment_intent_data: { metadata: { plan, utilisateur_id: identifiant || '' } } }),
      allow_promotion_codes: true,
      locale: 'fr',
      billing_address_collection: 'auto',
      automatic_tax: { enabled: process.env.STRIPE_TVA_AUTO === 'true' },
      success_url: `${base}/?paiement=ok&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?paiement=annule`
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (e) {
    console.error('create-checkout-session', e);
    return res.status(500).json({ erreur: e.message || 'Création de la session impossible.' });
  }
}
