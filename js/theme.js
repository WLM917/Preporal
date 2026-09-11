/* ═══════════════════════════════════════════════════════════
   theme.js — bascule clair / sombre et bandeau cookies
   Le thème initial est déjà posé par le script en tête
   d'index.html : ici on ne gère que le changement manuel.
   ═══════════════════════════════════════════════════════════ */

import { $, stock } from './ui.js';

const CLE_THEME = 'oralixia.theme';
const CLE_COOKIES = 'oralixia.cookies';

export const themeActuel = () => document.documentElement.dataset.theme || 'sombre';

/** Les icônes soleil / lune suivent le thème affiché. */
function majIcones() {
  const sombre = themeActuel() === 'sombre';
  const btn = $('#btn-theme');
  if (!btn) return;
  btn.querySelector('[data-icone="sombre"]').hidden = !sombre;
  btn.querySelector('[data-icone="clair"]').hidden = sombre;
  btn.setAttribute('aria-label', sombre ? 'Passer en thème clair' : 'Passer en thème sombre');
}

export function appliquerTheme(nom) {
  const valide = nom === 'clair' ? 'clair' : 'sombre';
  document.documentElement.dataset.theme = valide;
  // Écriture directe : la clé est lue par un script inline, avant les modules.
  try { localStorage.setItem(CLE_THEME, valide); } catch {}
  majIcones();
}

export function brancherTheme() {
  majIcones();
  $('#btn-theme')?.addEventListener('click', () => {
    appliquerTheme(themeActuel() === 'sombre' ? 'clair' : 'sombre');
  });

  // Sans choix explicite de l'utilisateur, on suit le réglage du système.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    let choix = null;
    try { choix = localStorage.getItem(CLE_THEME); } catch {}
    if (choix !== 'clair' && choix !== 'sombre') {
      document.documentElement.dataset.theme = e.matches ? 'clair' : 'sombre';
      majIcones();
    }
  });
}

/* ── Bandeau cookies ────────────────────────────────────────
   Oralixia ne dépose que des cookies strictement nécessaires
   (session Supabase, préférences locales). Le bandeau informe
   et mémorise le choix ; aucun traceur n'est chargé dans un
   cas comme dans l'autre.
   ─────────────────────────────────────────────────────────── */
export function brancherCookies() {
  const banniere = $('#banniere-cookies');
  if (!banniere) return;

  const dejaRepondu = stock.lire(CLE_COOKIES, null);
  if (!dejaRepondu) banniere.classList.remove('hidden');

  const repondre = choix => {
    stock.ecrire(CLE_COOKIES, { choix, date: new Date().toISOString() });
    banniere.classList.add('hidden');
  };

  $('#btn-cookies-accepter')?.addEventListener('click', () => repondre('accepte'));
  $('#btn-cookies-refuser')?.addEventListener('click', () => repondre('refuse'));
}
