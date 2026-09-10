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
import { LANGUES, langue, infoLangue, initLangue, changerLangue, surChangementLangue } from './i18n.js';
import { initAuth, surChangementCompte } from './auth.js';
import { brancherLegal } from './legal.js';
import { majJauge } from './paywall.js';

/* Marque l'entrée de menu active.

   Trois entrées pointent vers index.html : Accueil, Coach IA et Mon
   espace, qui ne diffèrent que par le paramètre ?vue=. Comparer les
   seuls chemins les allumait toutes les trois en même temps. */
const cheminDe = url => {
  const u = new URL(url, location.href);
  return { chemin: u.pathname.replace(/index\.html$/, '').replace(/\/$/, '') || '/',
           vue: u.searchParams.get('vue') || 'accueil' };
};

export function marquerPageCourante(vueActive) {
  const ici = cheminDe(location.href);
  const vue = vueActive || ici.vue;

  $$('[data-page]').forEach(a => {
    const cible = cheminDe(a.getAttribute('href') || '');
    // Sur index.html, c'est la vue affichée qui départage les trois entrées.
    const actif = cible.chemin === ici.chemin
      && (cible.chemin !== '/' || cible.vue === vue);

    a.classList.toggle('bg-iris', actif);
    a.classList.toggle('text-white', actif);
    a.classList.toggle('font-semibold', actif);
    a.classList.toggle('text-muted', !actif);
    if (actif) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ── Sélecteur de langue ────────────────────────────────────
   Un menu plutôt qu'un simple bouton bascule : trois langues ne
   se parcourent pas confortablement en cliquant, et un listbox
   annonce ses options aux lecteurs d'écran. */
function brancherSelecteurLangue() {
  const bouton = $('#btn-langue');
  const menu = $('#menu-langue');
  if (!bouton || !menu) return;

  const majEtiquette = () => {
    const info = infoLangue();
    const etiquette = $('#langue-courante');
    if (etiquette) etiquette.textContent = info.code.toUpperCase();
    bouton.setAttribute('aria-label', `Langue : ${info.etiquette}`);
  };

  const dessiner = () => {
    menu.innerHTML = Object.values(LANGUES).map(l => `
      <li role="option" aria-selected="${l.code === langue()}">
        <button type="button" data-langue="${l.code}" lang="${l.htmlLang}"
          class="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition hover:bg-raised ${
            l.code === langue() ? 'bg-iris/10 text-soft' : 'text-muted'}">
          <span aria-hidden="true">${l.drapeau}</span>
          <span>${l.etiquette}</span>
          ${l.code === langue() ? '<span class="ml-auto text-iris2" aria-hidden="true">✓</span>' : ''}
        </button>
      </li>`).join('');
  };

  const ouvrir = etat => {
    menu.classList.toggle('hidden', !etat);
    bouton.setAttribute('aria-expanded', String(etat));
    if (etat) dessiner();
  };

  bouton.addEventListener('click', e => {
    e.stopPropagation();
    ouvrir(menu.classList.contains('hidden'));
  });

  menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-langue]');
    if (!b) return;
    await changerLangue(b.dataset.langue);
    ouvrir(false);
    bouton.focus();
  });

  document.addEventListener('click', () => ouvrir(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ouvrir(false); });

  majEtiquette();
  surChangementLangue(() => { majEtiquette(); marquerPageCourante(); });
}

/**
 * Branche l'en-tête, le pied de page et les modales communes.
 * @param {object} [o]
 * @param {Function} [o.auChangementDeCompte] rappel après connexion/déconnexion
 */
export async function brancherNavigation({ auChangementDeCompte } = {}) {
  // La langue s'applique avant tout le reste : le balisage est en
  // français, il faut le traduire avant que l'utilisateur ne le lise.
  await initLangue();

  const annee = $('#annee');
  if (annee) annee.textContent = new Date().getFullYear();

  marquerPageCourante();
  brancherSelecteurLangue();
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
