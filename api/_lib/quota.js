/* ═══════════════════════════════════════════════════════════
   api/_lib/quota.js — quota des simulations, côté serveur.

   Le compteur du navigateur (localStorage) est un confort
   d'affichage : il suffit de vider le site pour le remettre à
   zéro, et rien n'empêche d'appeler /api/questions directement.
   La vérité se décide donc ici.

   Trois cas :
     • Premium (abonnement actif ou pass 48 h valide) → illimité
     • Connecté sans premium → quota compté dans « usages »
     • Anonyme → refusé par défaut

   Le quota anonyme reposait sur une empreinte IP + navigateur, que
   n'importe quel VPN ou fenêtre privée contourne : les deux
   simulations offertes se reprenaient à l'infini. Elles sont donc
   désormais rattachées à un compte. EXIGER_CONNEXION=false rétablit
   l'ancien comportement (empreinte), à ses risques.
   ═══════════════════════════════════════════════════════════ */

import { createHash } from 'node:crypto';
import { supabaseAdmin, utilisateurDepuisJeton } from './supabaseAdmin.js';
import { ipDe } from './ia.js';

export const SIMULATIONS_GRATUITES = Number(process.env.SIMULATIONS_GRATUITES || 2);
const EXIGER_CONNEXION = process.env.EXIGER_CONNEXION !== 'false';

/** Empreinte stable et non réversible d'un visiteur anonyme. */
function empreinteAnonyme(req) {
  const sel = process.env.SEL_EMPREINTE || process.env.SUPABASE_SERVICE_ROLE_KEY || 'prepOral';
  const brut = [ipDe(req), req.headers['user-agent'] || '', req.headers['accept-language'] || ''].join('|');
  return createHash('sha256').update(sel + brut).digest('hex').slice(0, 40);
}

/** Le profil est-il premium à cet instant ? */
async function estPremium(utilisateurId) {
  const sb = supabaseAdmin();
  if (!sb || !utilisateurId) return false;
  const { data } = await sb
    .from('profils')
    .select('premium, premium_jusqu_au')
    .eq('id', utilisateurId)
    .maybeSingle();
  if (!data?.premium) return false;
  // premium_jusqu_au null = abonnement récurrent piloté par les évènements Stripe.
  if (!data.premium_jusqu_au) return true;
  return new Date(data.premium_jusqu_au).getTime() > Date.now();
}

/**
 * Décide si l'appelant a le droit de lancer une simulation.
 * @returns {Promise<{autorise:boolean, motif?:string, code?:string,
 *                    premium:boolean, utilisateurId:string|null,
 *                    empreinte:string|null, utilisees:number, restant:number}>}
 */
export async function verifierQuota(req) {
  const sb = supabaseAdmin();
  const utilisateur = await utilisateurDepuisJeton(req);
  const utilisateurId = utilisateur?.id || null;

  // Sans base configurée, on ne peut rien garantir : on laisse passer
  // plutôt que de bloquer un service qui tourne en mode local.
  if (!sb) {
    return { autorise: true, premium: false, utilisateurId, empreinte: null,
             utilisees: 0, restant: SIMULATIONS_GRATUITES, sansBase: true };
  }

  if (utilisateurId && await estPremium(utilisateurId)) {
    return { autorise: true, premium: true, utilisateurId, empreinte: null,
             utilisees: 0, restant: Infinity };
  }

  if (!utilisateurId && EXIGER_CONNEXION) {
    return { autorise: false, premium: false, utilisateurId: null, empreinte: null,
             utilisees: 0, restant: 0, code: 'connexion',
             motif: `Créez un compte gratuit pour lancer une simulation : vos ${SIMULATIONS_GRATUITES} simulations offertes y sont rattachées.` };
  }

  let utilisees = 0;
  let empreinte = null;

  if (utilisateurId) {
    const { data } = await sb.from('usages').select('simulations')
      .eq('utilisateur_id', utilisateurId).maybeSingle();
    utilisees = Number(data?.simulations || 0);
  } else {
    empreinte = empreinteAnonyme(req);
    const { data } = await sb.from('usages_anonymes').select('simulations')
      .eq('empreinte', empreinte).maybeSingle();
    utilisees = Number(data?.simulations || 0);
  }

  const restant = Math.max(0, SIMULATIONS_GRATUITES - utilisees);
  if (restant > 0) {
    return { autorise: true, premium: false, utilisateurId, empreinte, utilisees, restant };
  }

  return {
    autorise: false, premium: false, utilisateurId, empreinte, utilisees, restant: 0,
    code: 'quota',
    motif: `Vos ${SIMULATIONS_GRATUITES} simulations gratuites sont utilisées. Passez au Premium pour continuer.`
  };
}

/**
 * Incrémente le compteur. À n'appeler qu'après une génération réussie :
 * une panne du modèle ne doit pas coûter une simulation au candidat.
 */
export async function consommerQuota(verdict) {
  const sb = supabaseAdmin();
  if (!sb || !verdict || verdict.premium || verdict.sansBase) return;

  try {
    if (verdict.utilisateurId) {
      await sb.from('usages').upsert({
        utilisateur_id: verdict.utilisateurId,
        simulations: (verdict.utilisees || 0) + 1,
        maj_le: new Date().toISOString()
      }, { onConflict: 'utilisateur_id' });
    } else if (verdict.empreinte) {
      await sb.from('usages_anonymes').upsert({
        empreinte: verdict.empreinte,
        simulations: (verdict.utilisees || 0) + 1,
        maj_le: new Date().toISOString()
      }, { onConflict: 'empreinte' });
    }
  } catch (e) {
    // Un échec d'écriture ne doit pas casser la simulation en cours.
    console.warn('Quota non incrémenté', e?.message || e);
  }
}

/** Réponse normalisée quand le quota est épuisé. */
export function refuserQuota(res, verdict) {
  return res.status(402).json({
    erreur: verdict.motif || 'Quota épuisé.',
    code: verdict.code || 'quota',
    restant: 0
  });
}
