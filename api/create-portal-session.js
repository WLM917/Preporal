/* ═══════════════════════════════════════════════════════════
   POST /api/create-portal-session
   Ouvre le portail client Stripe : changer de carte, consulter
   ses factures, résilier son abonnement.
   ═══════════════════════════════════════════════════════════ */

import Stripe from 'stripe';
import { utilisateurDepuisJeton, supabaseAdmin } from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'Méthode non autorisée.' });

  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return res.status(500).json({ erreur: "Stripe n'est pas configuré." });

  try {
    const stripe = new Stripe(cle, { apiVersion: '2024-06-20' });
    const { email, origine } = req.body || {};
    const utilisateur = await utilisateurDepuisJeton(req);
    const base = process.env.URL_PUBLIQUE || origine || `https://${req.headers.host}`;

    let clientId = null;

    // 1. On cherche l'identifiant client Stripe enregistré au moment du paiement.
    const sb = supabaseAdmin();
    if (sb && utilisateur?.id) {
      const { data } = await sb.from('profils').select('stripe_client_id').eq('id', utilisateur.id).maybeSingle();
      clientId = data?.stripe_client_id || null;
    }

    // 2. Repli : recherche par e-mail chez Stripe.
    if (!clientId) {
      const courriel = utilisateur?.email || email;
      if (!courriel) return res.status(400).json({ erreur: 'Connectez-vous pour gérer votre abonnement.' });
      const clients = await stripe.customers.list({ email: courriel, limit: 1 });
      clientId = clients.data[0]?.id || null;
    }

    if (!clientId) return res.status(404).json({ erreur: 'Aucun abonnement trouvé pour ce compte.' });

    const portail = await stripe.billingPortal.sessions.create({
      customer: clientId,
      locale: 'fr',
      return_url: `${base}/?vue=compte`
    });

    return res.status(200).json({ url: portail.url });
  } catch (e) {
    console.error('create-portal-session', e);
    return res.status(500).json({ erreur: e.message || "Ouverture du portail impossible." });
  }
}
