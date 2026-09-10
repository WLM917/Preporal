/* ═══════════════════════════════════════════════════════════
   nav.js — comportements d'en-tête partagés par toutes les pages

   Le site est composé de pages statiques distinctes (accueil,
   simulateur, témoignages). Le balisage de l'en-tête est répété
   dans chacune — volontairement, pour qu'il soit lisible par les
   moteurs et affiché sans attendre le JavaScript. Seul le
   comportement est mutualisé ici.
   ═══════════════════════════════════════════════════════════ */

import { $, $$ } from './ui.js';
import { brancherTheme, brancherCookies } from './theme.js';
import { initAuth, surChangementCompte } from './auth.js';
import { brancherLegal } from './legal.js';
import { majJauge } from './paywall.js';

/** Marque l'entrée de menu correspondant à la page courante. */
function marquerPageCourante() {
  const ici = location.pathname.replace(/\/$/, '') || '/index.html';
  $$('[data-page]').forEach(a => {
    const cible = a.getAttribute('href') || '';
    const actif = cible.replace(/^\.\//, '/') === ici
      || (ici === '/' && cible.includes('index'))
      || (ici === '/index.html' && cible.includes('index'));
    a.classList.toggle('bg-iris', actif);
    a.classList.toggle('text-white', actif);
    a.classList.toggle('font-semibold', actif);
    a.classList.toggle('text-muted', !actif);
    if (actif) a.setAttribute('aria-current', 'page');
  });
}

/**
 * Branche l'en-tête, le pied de page et les modales communes.
 * @param {object} [o]
 * @param {Function} [o.auChangementDeCompte] rappel après connexion/déconnexion
 */
export function brancherNavigation({ auChangementDeCompte } = {}) {
  const annee = $('#annee');
  if (annee) annee.textContent = new Date().getFullYear();

  marquerPageCourante();
  brancherTheme();
  brancherCookies();
  brancherLegal();

  initAuth().then(() => {
    surChangementCompte(() => {
      majJauge();
      auChangementDeCompte?.();
    });
  });
}
