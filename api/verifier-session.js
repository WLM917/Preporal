/* ═══════════════════════════════════════════════════════════
   POST /api/verifier-session
   Entrée : { sessionId }   (le {CHECKOUT_SESSION_ID} de Stripe)
   Sortie : { paye, plan, jusquA }

   Pourquoi cette route : le retour de paiement arrive sur
   /?paiement=ok&session_id=… — une URL que n'importe qui peut
   taper à la main. On ne débloque donc rien sur la foi du
   paramètre : on demande à Stripe si la session est réellement
   payée.

   Le webhook reste la source de vérité durable (il écrit le
   statut premium en base). Cette route ne sert qu'à donner un
   retour immédiat et honnête juste après le paiement.
   ═══════════════════════════════════════════════════════════ */

import Stripe from 'stripe';
import { limiter } from './_lib/ia.js';

const JOUR = 24 * 60 * 60 * 1000;
const DUREES = { pass48: 48 * 60 * 60 * 1000, extra: 183 * JOUR };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'Méthode non autorisée.' });
  if (!await limiter(req, res, { max: 20, prefixe: 'verif' })) return;

  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return res.status(500).json({ erreur: "Stripe n'est pas configuré." });

  const { sessionId } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return res.status(400).json({ erreur: 'Identifiant de session invalide.' });
  }

  try {
    const stripe = new Stripe(cle, { apiVersion: '2024-06-20' });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paye = session.payment_status === 'paid'
      || (session.mode === 'subscription' && session.status === 'complete');

    if (!paye) {
      return res.status(200).json({ paye: false, plan: null, jusquA: null });
    }

    const plan = session.metadata?.plan || (session.mode === 'subscription' ? 'mensuel' : 'pass48');
    // Les offres à paiement unique sont datées ; l'abonnement suit les évènements Stripe.
    const jusquA = DUREES[plan] ? Date.now() + DUREES[plan] : null;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ paye: true, plan, jusquA });

  } catch (e) {
    console.error('api/verifier-session', e?.message || e);
    // Session inconnue de Stripe : on ne débloque rien.
    return res.status(200).json({ paye: false, plan: null, jusquA: null });
  }
}
