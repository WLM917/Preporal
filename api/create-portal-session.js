/* ═══════════════════════════════════════════════════════════
   POST /api/create-portal-session
   Ouvre le portail client Stripe : changer de carte, consulter
   ses factures, passer de l'offre mensuelle à l'offre six mois,
   résilier son abonnement.
   Entrée : { langue? } — et le jeton de session, obligatoire.
   ═══════════════════════════════════════════════════════════ */

import Stripe from 'stripe';
import { utilisateurDepuisJeton, supabaseAdmin } from './_lib/supabaseAdmin.js';
import { configurationPortail, localePortail } from './_lib/portail.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'Méthode non autorisée.' });

  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) return res.status(500).json({ erreur: "Stripe n'est pas configuré." });

  /* Le portail donne la main sur un abonnement : factures, nom et
     adresse de facturation, carte, résiliation. Il ne s'ouvre donc
     qu'à la personne connectée, pour son propre compte.

     Sans jeton, l'endpoint cherchait le client Stripe avec l'adresse
     envoyée dans la requête — n'importe qui pouvait ouvrir le portail
     de n'importe quel abonné dont il connaissait l'e-mail, et résilier
     à sa place. */
  const utilisateur = await utilisateurDepuisJeton(req);
  if (!utilisateur?.id) {
    return res.status(401).json({ erreur: 'Connectez-vous pour gérer votre abonnement.' });
  }

  try {
    const stripe = new Stripe(cle, { apiVersion: '2024-06-20' });
    const { langue } = req.body || {};

    /* L'adresse du site vient de la configuration ou de l'hôte qui a
       reçu la requête, jamais du corps de la requête : elle part dans
       une configuration de portail partagée par tous les abonnés. */
    const base = process.env.URL_PUBLIQUE || `https://${req.headers.host}`;

    let clientId = null;

    // 1. L'identifiant client Stripe enregistré au moment du paiement.
    const sb = supabaseAdmin();
    if (sb) {
      const { data } = await sb.from('profils').select('stripe_client_id').eq('id', utilisateur.id).maybeSingle();
      clientId = data?.stripe_client_id || null;
    }

    // 2. Repli : l'adresse du compte — vérifiée par l'authentification.
    if (!clientId && utilisateur.email) {
      const clients = await stripe.customers.list({ email: utilisateur.email, limit: 1 });
      clientId = clients.data[0]?.id || null;
    }

    if (!clientId) return res.status(404).json({ erreur: 'Aucun abonnement trouvé pour ce compte.' });

    /* Sans configuration, le portail par défaut reste utilisable :
       résilier, changer de carte, lire ses factures. On n'en prive
       personne parce que l'échange de formules n'a pas pu être
       préparé — on le signale, et on ouvre quand même. */
    let configuration = null;
    try {
      configuration = await configurationPortail(stripe, { base });
    } catch (e) {
      console.error('Configuration du portail impossible — portail par défaut', e?.message || e);
    }

    const portail = await stripe.billingPortal.sessions.create({
      customer: clientId,
      // Le site est traduit : le portail suit la langue choisie, comme
      // la page de paiement.
      locale: localePortail(langue),
      return_url: `${base}/?vue=compte`,
      ...(configuration ? { configuration } : {})
    });

    return res.status(200).json({ url: portail.url });
  } catch (e) {
    console.error('create-portal-session', e);
    return res.status(500).json({ erreur: e.message || "Ouverture du portail impossible." });
  }
}
