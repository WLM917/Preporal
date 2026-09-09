/* ═══════════════════════════════════════════════════════════
   age.js — déclaration d'âge et consentement parental

   Deux règles françaises distinctes :

   • Moins de 15 ans : le traitement des données requiert l'accord
     du titulaire de l'autorité parentale (art. 45 de la loi
     Informatique et Libertés). On le recueille au moment de la
     création du compte.
   • Tout mineur : ne peut pas souscrire seul un abonnement payant
     (art. 1145 s. du code civil). C'est la case cochée dans la
     modale d'offre qui couvre ce point.

   On ne demande qu'une tranche d'âge, jamais une date de
   naissance : c'est le minimum nécessaire pour appliquer la règle.
   ═══════════════════════════════════════════════════════════ */

import { CONFIG } from './config.js';
import { $, stock, toast } from './ui.js';
import { supabase, session } from './auth.js';

const CLE = 'prepOral.age';

export const TRANCHES = {
  moins_15: { id: 'moins_15', libelle: 'Moins de 15 ans', consentementRequis: true, majeur: false },
  '15_17':  { id: '15_17',    libelle: 'Entre 15 et 17 ans', consentementRequis: false, majeur: false },
  majeur:   { id: 'majeur',   libelle: '18 ans ou plus', consentementRequis: false, majeur: true }
};

export const etatAge = {
  tranche: null,
  consentementParental: false
};

/* ── Lecture ───────────────────────────────────────────────── */

export function chargerAgeLocal() {
  const l = stock.lire(CLE, null);
  if (l && TRANCHES[l.tranche]) {
    etatAge.tranche = l.tranche;
    etatAge.consentementParental = Boolean(l.consentementParental);
  }
  return etatAge;
}

export async function chargerAgeProfil() {
  if (!supabase || !session.id) return etatAge;
  try {
    const { data } = await supabase
      .from('profils')
      .select('tranche_age, consentement_parental')
      .eq('id', session.id)
      .maybeSingle();
    if (data?.tranche_age) {
      etatAge.tranche = data.tranche_age;
      etatAge.consentementParental = Boolean(data.consentement_parental);
      stock.ecrire(CLE, { tranche: etatAge.tranche, consentementParental: etatAge.consentementParental });
    }
  } catch (e) { console.warn('Tranche d\'âge non chargée', e); }
  return etatAge;
}

/* ── Écriture ──────────────────────────────────────────────── */

export async function enregistrerAge(trancheId, { emailParent = null } = {}) {
  const tranche = TRANCHES[trancheId];
  if (!tranche) return false;

  etatAge.tranche = trancheId;
  // Sous 15 ans, le consentement n'est acquis que si un parent a été renseigné.
  etatAge.consentementParental = tranche.consentementRequis ? Boolean(emailParent) : true;

  stock.ecrire(CLE, { tranche: trancheId, consentementParental: etatAge.consentementParental });

  if (supabase && session.id) {
    try {
      await supabase.from('profils').update({
        tranche_age: trancheId,
        consentement_parental: etatAge.consentementParental,
        consentement_parental_le: etatAge.consentementParental ? new Date().toISOString() : null,
        email_parent: emailParent || null
      }).eq('id', session.id);
    } catch (e) { console.warn('Tranche d\'âge non synchronisée', e); }
  }
  return true;
}

/* ── Règles ────────────────────────────────────────────────── */

/** L'utilisateur peut-il utiliser le service (même gratuitement) ? */
export function peutUtiliser() {
  if (!etatAge.tranche) return true;                 // pas encore déclaré
  const t = TRANCHES[etatAge.tranche];
  return !t.consentementRequis || etatAge.consentementParental;
}

/** L'utilisateur peut-il payer seul ? */
export function peutPayerSeul() {
  return etatAge.tranche ? TRANCHES[etatAge.tranche].majeur : false;
}

/** Message à afficher dans la modale d'offre selon la tranche déclarée. */
export function messagePaiement() {
  if (!etatAge.tranche || TRANCHES[etatAge.tranche].majeur) return null;
  return `Vous avez déclaré avoir moins de ${CONFIG.ageMinimumAchat} ans : le paiement doit être `
       + `effectué par votre représentant légal, ou avec son accord exprès.`;
}

/* ── Interface ─────────────────────────────────────────────── */

export function brancherAge() {
  chargerAgeLocal();

  const zone = $('#choix-age');
  const champParent = $('#bloc-parent');
  const emailParent = $('#email-parent');
  const valider = $('#btn-valider-age');
  if (!zone) return;

  let choix = etatAge.tranche;

  const dessiner = () => {
    zone.innerHTML = Object.values(TRANCHES).map(t => `
      <button type="button" data-tranche="${t.id}" aria-pressed="${choix === t.id}"
        class="rounded-xl border px-4 py-3 text-sm font-medium transition ${
          choix === t.id ? 'border-iris bg-iris/10 text-soft' : 'border-line text-muted hover:border-iris/50'}">
        ${t.libelle}
      </button>`).join('');
    // Le courriel du parent n'est demandé qu'en dessous de 15 ans.
    champParent?.classList.toggle('hidden', choix !== 'moins_15');
    if (valider) valider.disabled = !choix;
  };
  dessiner();

  zone.addEventListener('click', e => {
    const b = e.target.closest('[data-tranche]');
    if (!b) return;
    choix = b.dataset.tranche;
    dessiner();
  });

  valider?.addEventListener('click', async () => {
    if (!choix) return;
    const courriel = (emailParent?.value || '').trim();

    if (choix === 'moins_15') {
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(courriel)) {
        return toast("Indiquez l'adresse e-mail de votre parent ou responsable légal.", 'erreur');
      }
    }

    await enregistrerAge(choix, { emailParent: choix === 'moins_15' ? courriel : null });

    if (choix === 'moins_15') {
      toast("Merci. Un message sera envoyé à votre responsable légal pour confirmer son accord.", 'succes');
    }
    document.getElementById('modal-age')?.setAttribute('hidden', '');
    document.body.style.overflow = '';
  });
}

/** Ouvre la déclaration d'âge si elle n'a jamais été faite. */
export function demanderAgeSiNecessaire() {
  if (etatAge.tranche) return false;
  const m = document.getElementById('modal-age');
  if (!m) return false;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  return true;
}
