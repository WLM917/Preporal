/* ═══════════════════════════════════════════════════════════
   POST /api/create-checkout-session
   Entrée : { plan: 'mensuel' | 'pass48' | 'extra', userId?,
              origine?, langue? }
   Sortie : { url }  → le navigateur est redirigé vers Stripe
   ═══════════════════════════════════════════════════════════ */

import Stripe from 'stripe';
import { utilisateurDepuisJeton } from './_lib/supabaseAdmin.js';
import { PLANS } from './_lib/plans.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'Méthode non autorisée.' });

  /* Rempli juste avant l'appel à Stripe : le bloc catch n'a pas accès
     aux constantes déclarées dans le try. */
  let diagnostic = null;
  const diagnostiquerTarif = async () => {
    if (!diagnostic) return null;
    const { stripe, priceId, config } = diagnostic;
    const prix = await stripe.prices.retrieve(priceId);
    const recurrent = Boolean(prix.recurring);
    if (recurrent === (config.mode === 'subscription')) return null;
    return config.mode === 'subscription'
      ? `${config.env} pointe vers un tarif à paiement unique, alors que l'offre « ${config.nom} » est un abonnement. Créez un tarif récurrent dans Stripe et remplacez ${config.env}.`
      : `${config.env} pointe vers un tarif récurrent, alors que l'offre « ${config.nom} » est un paiement unique. Créez un tarif ponctuel dans Stripe et remplacez ${config.env}.`;
  };

  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return res.status(500).json({ erreur: "Stripe n'est pas configuré (STRIPE_SECRET_KEY manquante)." });

  try {
    const stripe = new Stripe(cle, { apiVersion: '2024-06-20' });
    const { plan = 'mensuel', userId, origine, langue = 'fr' } = req.body || {};

    const config = PLANS[plan];
    if (!config) return res.status(400).json({ erreur: 'Offre inconnue.' });

    const priceId = process.env[config.env];
    if (!priceId) return res.status(500).json({ erreur: `Tarif Stripe manquant (${config.env}).` });

    // Si l'utilisateur est authentifié, on relie le paiement à son compte.
    const utilisateur = await utilisateurDepuisJeton(req);
    const identifiant = utilisateur?.id || userId || null;

    const base = process.env.URL_PUBLIQUE || origine || `https://${req.headers.host}`;

    /* Le diagnostic ci-dessous a besoin du client et de l'offre. */
    diagnostic = { stripe, priceId, config };

    const session = await stripe.checkout.sessions.create({
      mode: config.mode,
      line_items: [{ price: priceId, quantity: 1 }],
      /* L'adresse n'est pas pré-remplie, et ce n'est pas un oubli.

         Stripe la cherche alors dans Link : si le candidat y a un compte,
         la page de paiement s'ouvre directement sur une demande de code
         par SMS, au lieu de la liste des moyens de paiement. On ne voit
         plus ni carte, ni Apple Pay, ni Klarna — juste six cases et un
         téléphone qu'on n'a pas forcément sous la main.

         Sans pré-remplissage, la page s'ouvre sur le choix du moyen de
         paiement, Link compris, et le candidat saisit son adresse s'il
         le souhaite. Le rattachement au compte ne dépend pas d'elle :
         il passe par client_reference_id, ci-dessous. */
      client_reference_id: identifiant || undefined,
      metadata: { plan, utilisateur_id: identifiant || '' },
      ...(config.mode === 'subscription'
        ? {
            subscription_data: {
              metadata: { plan, utilisateur_id: identifiant || '' },
              /* Essai gratuit : Stripe ne débite qu'à la fin. Le webhook
                 accorde déjà l'accès pendant « trialing ». */
              ...(config.essaiJours > 0 ? { trial_period_days: config.essaiJours } : {})
            }
          }
        : { payment_intent_data: { metadata: { plan, utilisateur_id: identifiant || '' } } }),
      allow_promotion_codes: true,
      /* Stripe accepte 'fr', 'en', 'es' tels quels ; 'auto' suit le
         navigateur. Une langue inconnue de notre côté part en 'auto'
         plutôt que de ramener le client au français. */
      locale: ['fr', 'en', 'es'].includes(langue) ? langue : 'auto',
      billing_address_collection: 'auto',
      automatic_tax: { enabled: process.env.STRIPE_TVA_AUTO === 'true' },
      success_url: `${base}/?paiement=ok&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?paiement=annule`
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (e) {
    console.error('create-checkout-session', e);

    /* Un tarif ponctuel configuré sur une offre déclarée « subscription »
       (ou l'inverse) produit chez Stripe un message que personne ne peut
       relier à sa cause. On le traduit en instruction. */
    const mismatch = await diagnostiquerTarif().catch(() => null);
    if (mismatch) return res.status(500).json({ erreur: mismatch });

    return res.status(500).json({ erreur: e.message || 'Création de la session impossible.' });
  }
}
