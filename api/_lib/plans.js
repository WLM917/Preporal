/* ═══════════════════════════════════════════════════════════
   api/_lib/plans.js — les offres, vues du serveur

   Un seul endroit décrit ce qu'est chaque offre côté Stripe :
   le mode, la variable d'environnement qui porte son tarif, et
   sa période d'essai éventuelle. Le webhook et la création de
   session lisaient chacun leur propre version de cette table,
   ce qui suffisait tant qu'il n'existait qu'un abonnement.
   ═══════════════════════════════════════════════════════════ */

/** Jours d'essai offerts sur l'offre six mois. 0 désactive l'essai. */
export const ESSAI_EXTRA_JOURS = Number(process.env.ESSAI_EXTRA_JOURS ?? 7);

export const PLANS = {
  mensuel: {
    env: 'STRIPE_PRICE_MENSUEL',
    mode: 'subscription',
    nom: 'Oralixia Premium',
    essaiJours: 0
  },
  pass48: {
    // Paiement unique : rien n'est reconduit, l'échéance est posée
    // par le webhook à partir de DUREES.
    env: 'STRIPE_PRICE_PASS48',
    mode: 'payment',
    nom: 'Pass 48 heures',
    essaiJours: 0
  },
  extra: {
    /* Abonnement semestriel, et non plus paiement unique : une
       semaine d'essai n'existe chez Stripe que sur un abonnement,
       et seuls deux abonnements peuvent s'échanger l'un pour
       l'autre dans le portail client. La reconduction tacite qui
       en découle impose d'informer le client avant chaque échéance
       (art. L215-1 du code de la consommation) — voir le README. */
    env: 'STRIPE_PRICE_EXTRA',
    mode: 'subscription',
    nom: 'Oralixia Extra',
    essaiJours: ESSAI_EXTRA_JOURS
  }
};

/**
 * Retrouve la clé d'offre à partir d'un identifiant de tarif Stripe.
 * Sans cela, un abonné Extra serait étiqueté « mensuel » dès que le
 * portail client lui fait changer de formule.
 * @returns {string|null}
 */
export function planDepuisPrix(priceId) {
  if (!priceId) return null;
  for (const [cle, config] of Object.entries(PLANS)) {
    if (process.env[config.env] && process.env[config.env] === priceId) return cle;
  }
  return null;
}

/** Clé d'offre portée par un abonnement Stripe, métadonnées d'abord. */
export function planDeLAbonnement(sub) {
  const parMetadonnees = sub?.metadata?.plan;
  if (parMetadonnees && PLANS[parMetadonnees]) return parMetadonnees;

  const prix = sub?.items?.data?.[0]?.price?.id || sub?.plan?.id || null;
  return planDepuisPrix(prix);
}
