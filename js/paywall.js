/* ═══════════════════════════════════════════════════════════
   paywall.js — 2 simulations offertes, puis Stripe Checkout
   Le quota local est un confort d'affichage : la vérité fait
   foi côté serveur (statut Premium en base, voir api/webhook.js).
   ═══════════════════════════════════════════════════════════ */

import { CONFIG, OFFRES } from './config.js';
import { $, $$, stock, ouvrirModale, fermerModale, toast } from './ui.js';
import { session, profil } from './auth.js';

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
  ouvrirModale('modal-paywall');
}

/* ── Stripe Checkout ───────────────────────────────────────── */
export async function lancerCheckout(planId) {
  const offre = OFFRES[planId];
  if (!offre) return;
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

/* ── Retour de paiement (?paiement=ok) ─────────────────────── */
export function traiterRetourPaiement() {
  const params = new URLSearchParams(window.location.search);
  const etat = params.get('paiement');
  if (!etat) return;

  if (etat === 'ok') {
    const plan = params.get('plan');
    // Confort hors ligne : on débloque tout de suite côté navigateur.
    const jusquA = plan === 'pass48' ? Date.now() + 48 * 3600 * 1000 : Date.now() + 31 * 24 * 3600 * 1000;
    stock.ecrire(CONFIG.cles.premiumLocal, { plan, jusquA });
    toast('Paiement confirmé. Votre accès Premium est actif, bon entraînement.', 'succes');
  } else if (etat === 'annule') {
    toast('Paiement annulé. Vos simulations gratuites restent disponibles.');
  }
  history.replaceState({}, '', window.location.pathname);
  majJauge();
}

export function brancherPaywall() {
  $$('[data-plan]').forEach(b => b.addEventListener('click', () => lancerCheckout(b.dataset.plan)));
  $('#btn-premium')?.addEventListener('click', () => ouvrirPaywall('fin'));
  $('#btn-portail')?.addEventListener('click', ouvrirPortail);
  traiterRetourPaiement();
  majJauge();
}

export { fermerModale };
