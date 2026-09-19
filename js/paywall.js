/* ═══════════════════════════════════════════════════════════
   paywall.js — 2 simulations offertes, puis Stripe Checkout
   Le quota local est un confort d'affichage : la vérité fait
   foi côté serveur (statut Premium en base, voir api/webhook.js).
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, OFFRES, ORDRE_OFFRES, OFFRE_RECOMMANDEE } from './config.js';
import { t, langue, surChangementLangue } from './i18n.js';
import { $, $$, stock, echappe, ouvrirModale, fermerModale, toast } from './ui.js';
import { session, profil, surChangementCompte } from './auth.js';
import { messagePaiement } from './age.js';

/* Le compteur est rattaché au compte, pas au navigateur : chaque
   inscription ouvre bien ses deux simulations offertes, et un même
   navigateur partagé ne mélange pas les quotas de deux candidats.
   Il reste un confort d'affichage — api/_lib/quota.js fait foi. */
const cleQuota = () => session.id ? `${CONFIG.cles.quota}.${session.id}` : CONFIG.cles.quota;

export const quotaUtilise = () => Number(stock.lire(cleQuota(), 0)) || 0;
export const quotaRestant = () => Math.max(0, CONFIG.simulationsGratuites - quotaUtilise());

export function consommerSimulation() {
  if (estPremium()) return;
  stock.ecrire(cleQuota(), quotaUtilise() + 1);
  majJauge();
}

/** Premium = abonnement actif, ou pass 48 h encore valide. */
export function estPremium() {
  if (profil.premium) return true;
  const local = stock.lire(CONFIG.cles.premiumLocal, null);
  if (local && local.jusquA && Date.now() < local.jusquA) return true;
  return false;
}

export function peutLancer() { return estPremium() || quotaRestant() > 0; }

/** L'offre en cours, quand on sait laquelle. */
const offreCourante = () => OFFRES[profil.plan] || null;

/* Le libellé d'une offre passait à côté du dictionnaire : les cartes
   affichaient « Pass 48 heures » en anglais comme en espagnol. */
export const nomOffre = o => t(`offre.${o.id}.nom`, o.nom);

/* Les deux visages du bouton d'en-tête : appel à l'action tant que
   l'accès n'est pas payé, simple pastille d'information ensuite. */
const ENTETE_ACTION = 'rounded-xl bg-inverse px-4 py-2.5 font-display text-sm font-bold text-sur-inverse transition hover:opacity-90';
const ENTETE_PASTILLE = 'rounded-full border border-mint/40 bg-mint/10 px-3 py-1.5 font-display text-xs font-semibold text-mint';

/**
 * « Essayer gratuitement » n'a plus de sens une fois l'accès payé.
 *
 * En-tête : le bouton devient une pastille qui nomme l'offre en cours.
 * Elle cesse d'être un lien, et ce n'est pas un détail : un libellé
 * « Pass 48 heures » qui lancerait une simulation serait un piège.
 *
 * Accueil : le grand bouton invite à lancer une simulation. Pas « la
 * première » — rien ne dit que c'en est une, et un abonné en a déjà
 * fait dix.
 *
 * Le libellé passe par data-i18n plutôt que par du texte figé : sans
 * cela, changer de langue le réécrirait en « Essayer gratuitement ».
 */
export function majAppelsALAction() {
  const premium = estPremium();
  const offre = offreCourante();

  const poser = (el, cle, francais) => {
    if (!el) return;
    el.dataset.i18n = cle;
    el.dataset.i18nFr = francais;      // le repli que relit appliquerTraductions
    el.textContent = t(cle, francais);
  };

  const entete = $('#btn-essai');
  if (entete) {
    if (premium) {
      poser(entete, offre ? `offre.${offre.id}.nom` : 'accueil.acces_complet',
            offre ? offre.nom : 'Accès complet');
      entete.removeAttribute('href');
      entete.setAttribute('role', 'status');
      entete.className = ENTETE_PASTILLE;
    } else {
      poser(entete, 'accueil.essayer_gratuitement', 'Essayer gratuitement');
      entete.setAttribute('href', './simulateur.html');
      entete.removeAttribute('role');
      entete.className = ENTETE_ACTION;
    }
  }

  const heros = $('#btn-essai-heros [data-i18n]');
  if (premium) poser(heros, 'accueil.lancer_une_simulation', 'Lancer une simulation');
  else         poser(heros, 'accueil.essayer_gratuitement', 'Essayer gratuitement');
}

export function majJauge() {
  const el = $('#jauge-quota');
  if (!el) return;
  if (estPremium()) {
    el.textContent = t('quota.premium', 'Premium · simulations illimitées');
    el.className = 'rounded-md bg-iris/15 px-2 py-1 text-iris2';
  } else {
    const r = quotaRestant();
    el.textContent = r > 0
      ? t(r > 1 ? 'quota.restantes' : 'quota.restante',
          `${r} simulation${r > 1 ? 's' : ''} gratuite${r > 1 ? 's' : ''} restante${r > 1 ? 's' : ''}`)
          .replace('{n}', r)
      : t('quota.epuisees', 'Simulations gratuites épuisées');
    el.className = 'rounded-md bg-raised px-2 py-1 tabular-nums';
  }
}

/* ── Rendu des offres ───────────────────────────────────────
   Les tarifs viennent de config.js et ne sont écrits qu'à un seul
   endroit : un prix affiché qui ne correspond pas à celui facturé
   est une pratique commerciale trompeuse. */
export function rendreOffres() {
  const zone = $('#grille-offres');
  if (!zone) return;

  zone.innerHTML = ORDRE_OFFRES.map(id => {
    const o = OFFRES[id];
    const vedette = id === OFFRE_RECOMMANDEE;
    return `
    <button type="button" data-plan="${o.id}"
      class="plan relative flex h-full flex-col rounded-2xl border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-50
        ${vedette ? 'border-iris bg-iris/10 hover:brightness-110' : 'border-line bg-ink/50 hover:border-iris/60'}">
      ${vedette ? `<span class="absolute -top-2.5 left-5 rounded-full bg-iris px-2.5 py-0.5 text-[11px] font-semibold text-white">${echappe(t('offre.recommande', 'Recommandé'))}</span>` : ''}
      <span class="text-xs font-medium ${vedette ? 'text-iris2' : 'text-muted'}">${echappe(t(`offre.${o.id}.accroche`, o.accroche))}</span>
      <span class="mt-1 block font-display text-lg font-bold leading-tight">${echappe(nomOffre(o))}</span>
      <span class="mt-3 block">
        <span class="whitespace-nowrap font-display text-2xl font-extrabold">${echappe(o.prix)}</span>
        <span class="ml-1.5 whitespace-nowrap text-xs text-muted">${echappe(t('offre.periode.' + o.periode.replace(/[^a-z0-9]+/gi, '_'), o.periode))}</span>
      </span>
      ${o.essaiJours
        ? `<span class="mt-2 inline-flex rounded-full border border-mint/50 bg-mint/10 px-2 py-0.5 text-[11px] font-medium text-mint">${echappe(
            t('offre.essai', '{n} jours offerts').replace('{n}', o.essaiJours))}</span>`
        : ''}
      ${o.equivalentMensuel
        ? `<span class="mt-1 block text-xs text-mint">${echappe(
            t('offre.equivalent', '{m} par mois · soit {e} de moins que six mois au tarif mensuel')
              .replace('{m}', o.equivalentMensuel).replace('{e}', o.economie))}</span>`
        : ''}
      <span class="mt-3 block text-sm leading-relaxed text-muted">${echappe(t(`offre.${o.id}.detail`, o.detail))}</span>
    </button>`;
  }).join('');

  $$('[data-plan]').forEach(b => b.addEventListener('click', () => lancerCheckout(b.dataset.plan)));
  majEtatOffres();
}

/* Les offres restent cliquables, même sans la case cochée.

   Elles étaient désactivées tant qu'on ne l'avait pas décochée — et un
   bouton désactivé n'émet aucun clic : toucher une offre ne produisait
   rien du tout, pas même le message d'explication, qui n'était donc
   jamais atteint. Sur une tablette, on touchait trois cartes grisées
   sans comprendre, avant de finir par trouver la case en bas.

   Le paiement reste interdit sans la déclaration : lancerCheckout la
   vérifie, et affiche le rappel contre la case. */
function majEtatOffres() {
  if ($('#confirmation-age')?.checked) effacerRappelAge();
}

/** @param {'quota'|'fin'} raison */
export function ouvrirPaywall(raison = 'quota') {
  rendreOffres();
  const titre = $('#paywall-titre');
  const sur = titre?.previousElementSibling;
  if (raison === 'fin') {
    if (sur) sur.textContent = t('paywall.sur_fin', 'Belle simulation');
    if (titre) titre.textContent = t('paywall.titre_fin', 'Passez au niveau au-dessus');
  } else {
    if (sur) sur.textContent = t('paywall.sur_quota', 'Vos {n} simulations gratuites sont utilisées')
      .replace('{n}', CONFIG.simulationsGratuites);
    if (titre) titre.textContent = t('paywall.titre_quota', 'Continuez à vous entraîner');
  }
  // Rappel explicite quand l'utilisateur a déclaré être mineur.
  const avis = $('#avis-mineur');
  if (avis) {
    const message = messagePaiement();
    avis.textContent = message || '';
    avis.classList.toggle('hidden', !message);
  }

  ouvrirModale('modal-paywall');
}

/** Chemin courant, débarrassé des traces d'un paiement précédent. */
function pageDeRetour() {
  const url = new URL(window.location.href);
  ['paiement', 'plan', 'session_id'].forEach(c => url.searchParams.delete(c));
  return url.pathname + (url.searchParams.toString() ? '?' + url.searchParams : '');
}

/* ── Déclaration d'âge, exigée avant tout paiement ──────────── */

/** Met la case en évidence, et la ramène sous les yeux. */
function signalerAgeManquant() {
  const bloc = $('#bloc-confirmation-age');
  const rappel = $('#rappel-confirmation-age');
  const message = t('paywall.confirmer_age',
    "Confirmez d'abord avoir {n} ans ou l'accord de votre représentant légal.")
    .replace('{n}', CONFIG.ageMinimumAchat);

  if (rappel) { rappel.textContent = message; rappel.classList.remove('hidden'); }
  bloc?.classList.add('border-coral', 'bg-coral/10');
  bloc?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#confirmation-age')?.focus({ preventScroll: true });

  // Sans balisage pour l'afficher, le message doit passer quelque part.
  if (!rappel) toast(message, 'erreur');
}

/** Efface le rappel dès que la case est cochée. */
function effacerRappelAge() {
  $('#rappel-confirmation-age')?.classList.add('hidden');
  $('#bloc-confirmation-age')?.classList.remove('border-coral', 'bg-coral/10');
}

/* ── Stripe Checkout ───────────────────────────────────────── */
export async function lancerCheckout(planId) {
  const offre = OFFRES[planId];
  if (!offre) return;

  /* Un mineur non émancipé ne peut pas souscrire seul (art. 1145 s. du code
     civil). La case reste donc obligatoire — mais le refus se voyait à peine :
     il n'apparaissait que dans un bandeau en bas de l'écran, à vingt
     centimètres de l'offre qu'on venait de toucher sur une tablette. On
     cliquait, rien ne semblait se produire, et il fallait recommencer.
     Le rappel s'affiche maintenant contre la case, qui est amenée à l'écran
     et encadrée de rouge. */
  if (!$('#confirmation-age')?.checked) {
    signalerAgeManquant();
    return;
  }

  const bouton = $(`[data-plan="${planId}"]`);
  const texteInitial = bouton?.innerHTML;
  if (bouton) { bouton.disabled = true; bouton.style.opacity = '.6'; }

  try {
    const r = await fetch(`${CONFIG.api}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session.jeton ? { Authorization: 'Bearer ' + session.jeton } : {})
      },
      body: JSON.stringify({
        plan: planId,
        userId: session.id || undefined,
        origine: window.location.origin,
        /* La page d'où l'on part, pour y revenir. Le bouton de retour
           de Stripe ramenait à l'accueil, même venu de « Mon espace ».
           Les paramètres d'un paiement précédent sont retirés : ils
           relanceraient la confirmation au retour. */
        retour: pageDeRetour(),
        // La page de paiement fait partie du site : elle s'ouvre
        // dans la langue choisie, pas systématiquement en français.
        langue: langue()
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error(data.erreur || t('paywall.session_indispo', 'Session de paiement indisponible.'));
    window.location.assign(data.url);   // redirection vers Stripe Checkout
  } catch (e) {
    if (bouton) { bouton.disabled = false; bouton.style.opacity = ''; bouton.innerHTML = texteInitial; }
    toast(e.message || t('paywall.demarrage_echec', "Le paiement n'a pas pu démarrer. Réessayez dans un instant."), 'erreur');
  }
}

/** Portail client Stripe : changer de carte, résilier, factures. */
export async function ouvrirPortail() {
  try {
    const r = await fetch(`${CONFIG.api}/create-portal-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session.jeton ? { Authorization: 'Bearer ' + session.jeton } : {})
      },
      body: JSON.stringify({ userId: session.id, email: session.email, origine: window.location.origin })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error(data.erreur || t('paywall.portail_indispo', 'Portail indisponible.'));
    window.location.assign(data.url);
  } catch (e) {
    toast(e.message || t('paywall.portail_echec', "Impossible d'ouvrir le portail d'abonnement."), 'erreur');
  }
}

/* ── Retour de paiement (?paiement=ok) ───────────────────────
   Le paramètre d'URL ne prouve rien : n'importe qui peut taper
   /?paiement=ok. On demande donc à Stripe, via /api/verifier-session,
   si la session a réellement été payée avant de débloquer quoi que
   ce soit. Le webhook reste la source de vérité durable.
   ─────────────────────────────────────────────────────────── */
export async function traiterRetourPaiement() {
  const params = new URLSearchParams(window.location.search);
  const etat = params.get('paiement');
  if (!etat) return;

  const sessionId = params.get('session_id');

  // On nettoie l'URL tout de suite, en préservant les autres paramètres.
  params.delete('paiement'); params.delete('plan'); params.delete('session_id');
  const reste = params.toString();
  history.replaceState({}, '', window.location.pathname + (reste ? '?' + reste : ''));

  if (etat === 'annule') {
    toast(t('paywall.annule', 'Paiement annulé. Vos simulations gratuites restent disponibles.'));
    majJauge();
    return;
  }
  if (etat !== 'ok') return;

  if (!sessionId) {
    toast(t('paywall.recu', "Paiement reçu. Votre accès s'activera d'ici quelques secondes."));
    majJauge();
    return;
  }

  try {
    const r = await fetch(`${CONFIG.api}/verifier-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session.jeton ? { Authorization: 'Bearer ' + session.jeton } : {})
      },
      body: JSON.stringify({ sessionId })
    });
    const data = await r.json().catch(() => ({}));

    if (data.paye) {
      // Confort d'affichage uniquement : la vérité reste le champ premium en base.
      stock.ecrire(CONFIG.cles.premiumLocal, {
        plan: data.plan,
        jusquA: data.jusquA || Date.now() + 31 * 24 * 3600 * 1000
      });
      toast(t('paywall.confirme', 'Paiement confirmé. Votre accès Premium est actif, bon entraînement.'), 'succes');
    } else {
      toast(t('paywall.non_confirme', "Nous n'avons pas pu confirmer ce paiement. Si vous avez été débité, contactez-nous."), 'erreur');
    }
  } catch {
    toast(t('paywall.verif_impossible', "Vérification du paiement impossible pour l'instant. Rechargez la page dans un instant."));
  }

  majJauge();
}

export function brancherPaywall() {
  rendreOffres();
  // Les offres et la jauge sont dessinées en JavaScript : elles doivent
  // être redessinées quand la langue change.
  surChangementLangue(() => { rendreOffres(); majJauge(); });
  $('#confirmation-age')?.addEventListener('change', majEtatOffres);
  $('#btn-premium')?.addEventListener('click', () => ouvrirPaywall('fin'));
  $('#btn-portail')?.addEventListener('click', ouvrirPortail);
  traiterRetourPaiement();   // asynchrone : n'immobilise pas le démarrage
  // Le quota est rattaché au compte : il se redessine à chaque connexion.
  surChangementCompte(majJauge);
}

export { fermerModale };
