/* ═══════════════════════════════════════════════════════════
   POST /api/webhook — évènements Stripe
   Source de vérité du statut Premium.

   Vercel doit livrer le corps BRUT pour vérifier la signature :
   d'où bodyParser: false ci-dessous.

   Configuration Stripe → Developers → Webhooks :
     URL         https://votre-domaine.fr/api/webhook
     Évènements  checkout.session.completed
                 customer.subscription.updated
                 customer.subscription.deleted
                 invoice.payment_failed
   ═══════════════════════════════════════════════════════════ */

import Stripe from 'stripe';
import { majProfil, profilParClientStripe } from './_lib/supabaseAdmin.js';
import { planDeLAbonnement } from './_lib/plans.js';

export const config = { api: { bodyParser: false } };

const corpsBrut = req => new Promise((ok, ko) => {
  const morceaux = [];
  req.on('data', c => morceaux.push(Buffer.from(c)));
  req.on('end', () => ok(Buffer.concat(morceaux)));
  req.on('error', ko);
});


/* Durée d'accès des offres à paiement unique. L'abonnement mensuel
   n'y figure pas : son échéance vient des évènements subscription.*. */
/* Durées des offres à paiement unique. « extra » n'y figure plus :
   c'est un abonnement semestriel depuis l'ajout de la semaine
   d'essai, et son échéance vient de current_period_end. L'y laisser
   aurait figé une date à six mois, quels que soient l'essai en cours
   ou une résiliation ultérieure. */
const DUREES = {
  pass48: 48 * 60 * 60 * 1000
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Méthode non autorisée.');

  const cle = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!cle || !secret) return res.status(500).end('Stripe non configuré.');

  const stripe = new Stripe(cle, { apiVersion: '2024-06-20' });

  let evenement;
  try {
    const brut = await corpsBrut(req);
    evenement = stripe.webhooks.constructEvent(brut, req.headers['stripe-signature'], secret);
  } catch (e) {
    console.error('Signature Stripe invalide', e.message);
    return res.status(400).end(`Signature invalide : ${e.message}`);
  }

  try {
    switch (evenement.type) {

      case 'checkout.session.completed': {
        const s = evenement.data.object;
        const utilisateurId = s.client_reference_id || s.metadata?.utilisateur_id || null;
        const plan = s.metadata?.plan || (s.mode === 'subscription' ? 'mensuel' : 'pass48');
        /* Un abonnement pose son échéance via les évènements
           subscription.* : on ne lui invente pas de date ici. */

        const duree = DUREES[plan];
        const jusquA = duree
          ? new Date(Date.now() + duree).toISOString()
          : null;   // l'abonnement est piloté par les évènements subscription.*

        if (utilisateurId) {
          await majProfil(utilisateurId, {
            premium: true,
            plan,
            premium_jusqu_au: jusquA,
            stripe_client_id: typeof s.customer === 'string' ? s.customer : s.customer?.id || null,
            email: s.customer_details?.email || null
          });
        }
        console.log('Paiement confirmé', { plan, utilisateurId });
        break;
      }

      /* « created » compte autant que « updated » : un abonnement ouvert
         avec une semaine d'essai arrive en statut « trialing », et c'est
         cet évènement-là qui l'annonce. */
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = evenement.data.object;
        const actif = ['active', 'trialing', 'past_due'].includes(sub.status);
        const utilisateurId = sub.metadata?.utilisateur_id
          || (await profilParClientStripe(String(sub.customer)))?.id;

        /* L'offre se lit sur le tarif souscrit. Écrire « mensuel » en dur
           étiquetait tout abonné Extra comme mensuel dès qu'il changeait
           de formule depuis le portail client. */
        const plan = planDeLAbonnement(sub) || 'mensuel';

        if (utilisateurId) {
          await majProfil(utilisateurId, {
            premium: actif,
            plan,
            premium_jusqu_au: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
            stripe_client_id: String(sub.customer)
          });
        }
        console.log('Abonnement', { plan, statut: sub.status, utilisateurId });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = evenement.data.object;
        const utilisateurId = sub.metadata?.utilisateur_id
          || (await profilParClientStripe(String(sub.customer)))?.id;
        if (utilisateurId) {
          await majProfil(utilisateurId, { premium: false, plan: null, premium_jusqu_au: null });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const f = evenement.data.object;
        console.warn('Paiement en échec pour le client', f.customer);
        break;
      }

      default:
        // Les autres évènements sont ignorés volontairement.
        break;
    }

    return res.status(200).json({ recu: true });
  } catch (e) {
    console.error('Traitement du webhook', e);
    // On renvoie 500 : Stripe réessaiera automatiquement.
    return res.status(500).end('Erreur de traitement.');
  }
}
