/* ═══════════════════════════════════════════════════════════
   api/_lib/portail.js — ce que le portail client Stripe permet

   Le portail s'ouvrait sans configuration : Stripe appliquait
   donc celle par défaut, où l'échange de formules est désactivé.
   Le bouton « Résilier ou changer de formule » menait à une page
   qui ne proposait que de résilier, et les CGV promettaient que
   « le portail permet de passer d'une formule à l'autre ».

   La configuration est décrite ici, dans le code, plutôt que
   cochée à la main dans le tableau de bord Stripe : elle se
   relit, se teste, et ne dépend pas d'un réglage qu'on oublie.
   Elle n'est créée qu'une fois : une signature dans ses
   métadonnées permet de la retrouver aux appels suivants, et un
   changement de tarif en produit une nouvelle.

   Seuls les deux ABONNEMENTS s'échangent. Le Pass 48 heures est
   un paiement unique : Stripe n'échange qu'un tarif récurrent
   contre un autre, et passer d'un abonnement à un pass n'est
   pas un changement de formule mais une résiliation suivie d'un
   achat.
   ═══════════════════════════════════════════════════════════ */

import { PLANS } from './plans.js';

/* Versionnée : changer ce que la configuration permet — et non
   seulement ses tarifs — doit en créer une nouvelle, sans quoi
   l'ancienne resterait retrouvée par sa signature. */
const VERSION = 'formules-v1';

/** Les abonnements dont le tarif est configuré, dans l'ordre du catalogue. */
export function formulesEchangeables(env = process.env) {
  return Object.entries(PLANS)
    .filter(([, config]) => config.mode === 'subscription' && env[config.env])
    .map(([cle, config]) => ({ cle, prix: env[config.env] }));
}

/** Ce qui identifie une configuration : ses tarifs, ses liens, sa version. */
export const signatureDe = (formules, base) =>
  [VERSION, formules.map(f => f.prix).join(','), base].join('|');

/**
 * Regroupe les tarifs par produit.
 *
 * Stripe refuse qu'un même produit apparaisse deux fois : si
 * l'offre mensuelle et l'offre six mois sont deux tarifs d'un seul
 * produit, ils doivent arriver ensemble. Un tarif ponctuel est
 * écarté — il ne peut pas remplacer un abonnement.
 */
export function produitsPourPortail(prix = []) {
  const parProduit = new Map();
  for (const p of prix) {
    if (!p?.id || !p.recurring) continue;
    const produit = typeof p.product === 'string' ? p.product : p.product?.id;
    if (!produit) continue;
    if (!parProduit.has(produit)) parProduit.set(produit, []);
    parProduit.get(produit).push(p.id);
  }
  return [...parProduit].map(([product, prices]) => ({ product, prices }));
}

/**
 * Les paramètres envoyés à Stripe.
 *
 * Chaque réglage reprend ce que les CGV annoncent :
 *  • la résiliation prend effet à la fin de la période réglée, et
 *    aucun prorata n'est remboursé (art. 4) ;
 *  • un changement de formule prend effet immédiatement, la part non
 *    utilisée de la période en cours étant portée au crédit du client.
 *    Les deux formules n'ont pas la même période : Stripe facture donc
 *    le changement tout de suite, déduction faite de ce crédit.
 */
export function parametresPortail({ produits, base, signature }) {
  return {
    business_profile: {
      privacy_policy_url: `${base}/?legal=confidentialite`,
      terms_of_service_url: `${base}/?legal=cgv`
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        proration_behavior: 'none'
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: produits
      }
    },
    metadata: { oralixia: signature }
  };
}

/* Une configuration par instance de fonction : la retrouver chez
   Stripe à chaque ouverture du portail serait un appel de trop. */
let enCache = null;

/** Pour les tests : oublier ce qui a été retrouvé. */
export const oublierConfiguration = () => { enCache = null; };

/**
 * L'identifiant de la configuration à passer au portail, ou null si
 * rien ne s'échange (moins de deux abonnements configurés, ou tarifs
 * qui ne sont pas récurrents).
 *
 * @param {import('stripe').Stripe} stripe
 * @param {{ base: string }} o  l'adresse publique du site, pour les liens légaux
 */
export async function configurationPortail(stripe, { base }) {
  const formules = formulesEchangeables();
  if (formules.length < 2) return null;

  const signature = signatureDe(formules, base);
  if (enCache?.signature === signature) return enCache.id;

  // Déjà créée par une instance précédente ?
  const existantes = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const trouvee = (existantes?.data || []).find(c => c?.metadata?.oralixia === signature);
  if (trouvee) {
    enCache = { signature, id: trouvee.id };
    return trouvee.id;
  }

  // Sinon on la crée — il faut pour cela le produit de chaque tarif.
  const prix = await Promise.all(formules.map(f => stripe.prices.retrieve(f.prix)));
  const produits = produitsPourPortail(prix);
  const nbTarifs = produits.reduce((n, p) => n + p.prices.length, 0);
  if (nbTarifs < 2) return null;     // un seul abonnement réel : rien à échanger

  const creee = await stripe.billingPortal.configurations.create(
    parametresPortail({ produits, base, signature }));
  enCache = { signature, id: creee.id };
  return creee.id;
}

/** La langue du site, dans les codes que le portail comprend. */
export const localePortail = langue =>
  ['fr', 'en', 'es'].includes(langue) ? langue : 'auto';
