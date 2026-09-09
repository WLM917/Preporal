/* ═══════════════════════════════════════════════════════════
   paywall.js — 2 simulations offertes, puis Stripe Checkout
   Le quota local est un confort d'affichage : la vérité fait
   foi côté serveur (statut Premium en base, voir api/webhook.js).
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, OFFRES } from './config.js';
import { $, $$, stock, ouvrirModale, fermerModale, toast } from './ui.js';
import { session, profil } from './auth.js';
import { messagePaiement } from './age.js';

export const quotaUtilise = () => Number(stock.lire(CONFIG.cles.quota, 0)) || 0;
export const quotaRestant = () => Math.max(0, CONFIG.simulationsGratuites - quotaUtilise());

export function consommerSimulation() {
  if (estPremium()) return;
  stock.ecrire(CONFIG.cles.quota, quotaUtilise() + 1);
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

export function majJauge() {
  const el = $('#jauge-quota');
  if (!el) return;
  if (estPremium()) {
    el.textContent = 'Premium · simulations illimitées';
    el.className = 'rounded-md bg-iris/15 px-2 py-1 text-iris2';
  } else {
    const r = quotaRestant();
    el.textContent = r > 0
      ? `${r} simulation${r > 1 ? 's' : ''} gratuite${r > 1 ? 's' : ''} restante${r > 1 ? 's' : ''}`
      : 'Simulations gratuites épuisées';
    el.className = 'rounded-md bg-raised px-2 py-1 tabular-nums';
  }
}

/** @param {'quota'|'fin'} raison */
export function ouvrirPaywall(raison = 'quota') {
  const titre = $('#paywall-titre');
  const sur = titre?.previousElementSibling;
  if (raison === 'fin') {
    if (sur) sur.textContent = 'Belle première simulation';
    if (titre) titre.textContent = 'Passez au niveau au-dessus';
  } else {
    if (sur) sur.textContent = `Vos ${CONFIG.simulationsGratuites} simulations gratuites sont utilisées`;
    if (titre) titre.textContent = 'Continuez à vous entraîner';
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

/* ── Stripe Checkout ───────────────────────────────────────── */
export async function lancerCheckout(planId) {
  const offre = OFFRES[planId];
  if (!offre) return;

  // Un mineur non émancipé ne peut pas souscrire seul (art. 1145 s. du code civil).
  if (!$('#confirmation-age')?.checked) {
    toast(`Confirmez d'abord avoir ${CONFIG.ageMinimumAchat} ans ou l'accord de votre représentant légal.`, 'erreur');
    $('#confirmation-age')?.focus();
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
        email: session.email || undefined,
        userId: session.id || undefined,
        origine: window.location.origin
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) throw new Error(data.erreur || 'Session de paiement indisponible.');
    window.location.assign(data.url);   // redirection vers Stripe Checkout
  } catch (e) {
    if (bouton) { bouton.disabled = false; bouton.style.opacity = ''; bouton.innerHTML = texteInitial; }
    toast(e.message || "Le paiement n'a pas pu démarrer. Réessayez dans un instant.", 'erreur');
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
    if (!r.ok || !data.url) throw new Error(data.erreur || 'Portail indisponible.');
    window.location.assign(data.url);
  } catch (e) {
    toast(e.message || "Impossible d'ouvrir le portail d'abonnement.", 'erreur');
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
    toast('Paiement annulé. Vos simulations gratuites restent disponibles.');
    majJauge();
    return;
  }
  if (etat !== 'ok') return;

  if (!sessionId) {
    toast("Paiement reçu. Votre accès s'activera d'ici quelques secondes.");
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
      toast('Paiement confirmé. Votre accès Premium est actif, bon entraînement.', 'succes');
    } else {
      toast("Nous n'avons pas pu confirmer ce paiement. Si vous avez été débité, contactez-nous.", 'erreur');
    }
  } catch {
    toast("Vérification du paiement impossible pour l'instant. Rechargez la page dans un instant.");
  }

  majJauge();
}

export function brancherPaywall() {
  $$('[data-plan]').forEach(b => b.addEventListener('click', () => lancerCheckout(b.dataset.plan)));

  const confirmation = $('#confirmation-age');
  const majOffres = () => $$('[data-plan]').forEach(b => { b.disabled = !confirmation?.checked; });
  confirmation?.addEventListener('change', majOffres);
  majOffres();
  $('#btn-premium')?.addEventListener('click', () => ouvrirPaywall('fin'));
  $('#btn-portail')?.addEventListener('click', ouvrirPortail);
  traiterRetourPaiement();   // asynchrone : n'immobilise pas le démarrage
  majJauge();
}

export { fermerModale };
