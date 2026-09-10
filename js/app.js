/* ═══════════════════════════════════════════════════════════
   app.js — page d'accueil

   L'accueil porte trois vues : la page de présentation, le
   coach IA et Mon espace. Le simulateur vit sur sa propre page
   (simulateur.js) : on y arrive par « Essayer gratuitement ».
   ═══════════════════════════════════════════════════════════ */

import { $, $$ } from './ui.js';
import { Voix } from './speech.js';
import { session, surChangementCompte } from './auth.js';
import { brancherPaywall, majJauge } from './paywall.js';
import { brancherHistorique, chargerDepuisServeur } from './history.js';
import { brancherRelecture } from './relecture.js';
import { rendreAvis, chargerAvisPublies } from './reviews.js';
import { initCoach, arreterCoach } from './coach.js';
import { chargerAgeProfil } from './age.js';
import { brancherNavigation } from './nav.js';

/* ═══ Navigation entre vues ═══ */
const VUES = ['accueil', 'coach', 'compte'];

function allerVue(nom, { historique = true } = {}) {
  if (!VUES.includes(nom)) nom = 'accueil';

  VUES.forEach(v => $('#vue-' + v)?.classList.toggle('hidden', v !== nom));

  if (nom !== 'coach') arreterCoach();
  if (nom !== 'coach') Voix.stop();

  // L'URL reflète la vue : le retour arrière du navigateur fonctionne,
  // et un lien vers ?vue=compte reste partageable.
  if (historique) {
    const url = new URL(location.href);
    if (nom === 'accueil') url.searchParams.delete('vue');
    else url.searchParams.set('vue', nom);
    history.pushState({ vue: nom }, '', url);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Les liens d'en-tête vers une vue de cette page ne rechargent pas. */
function brancherLiensDeVue() {
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-vue-lien]');
    if (!a) return;
    e.preventDefault();
    allerVue(a.dataset.vueLien);
  });

  addEventListener('popstate', () => {
    allerVue(new URLSearchParams(location.search).get('vue') || 'accueil', { historique: false });
  });
}

/* ═══ Démarrage ═══ */
function demarrer() {
  brancherNavigation({ auChangementDeCompte: majJauge });

  brancherLiensDeVue();
  brancherPaywall();
  brancherHistorique();
  brancherRelecture();
  rendreAvis();
  initCoach();

  surChangementCompte(() => {
    chargerDepuisServeur();
    chargerAvisPublies();
    chargerAgeProfil();
  });

  // Vue demandée par l'URL : ?vue=compte au retour d'une simulation,
  // ou ?vue=coach depuis le menu.
  allerVue(new URLSearchParams(location.search).get('vue') || 'accueil', { historique: false });
}

demarrer();
