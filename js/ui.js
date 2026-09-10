/* ═══════════════════════════════════════════════════════════
   ui.js — briques d'interface partagées par tous les modules
   ═══════════════════════════════════════════════════════════ */

export const $  = (sel, racine = document) => racine.querySelector(sel);
export const $$ = (sel, racine = document) => [...racine.querySelectorAll(sel)];

/** Échappe le HTML : tout texte venant de l'utilisateur ou du modèle passe ici. */
export const echappe = (txt = '') =>
  String(txt).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 125 → « 2:05 », valeur négative → « +0:12 » */
export function formaterTemps(s) {
  const m = Math.floor(Math.abs(s) / 60), r = Math.abs(s) % 60;
  return (s < 0 ? '+' : '') + m + ':' + String(r).padStart(2, '0');
}

export const compterMots = txt => (txt || '').trim() ? txt.trim().split(/\s+/).length : 0;

/* Les teintes de note suivent le thème : on lit les variables CSS
   plutôt que de figer des hexadécimaux (voir index.html). */
export const jeton = (nom, repli) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
  return v ? `rgb(${v})` : repli;   // les variables stockent des canaux RVB
};

export const couleurNote = n =>
  n >= 70 ? jeton('--mint', 'rgb(61 220 151)')
  : n >= 45 ? jeton('--amber', 'rgb(245 165 36)')
  : jeton('--coral', 'rgb(255 93 108)');

/* ── Modales ───────────────────────────────────────────────── */
let derniereFocus = null;

export function ouvrirModale(id) {
  const m = document.getElementById(id);
  if (!m) return;
  derniereFocus = document.activeElement;
  m.hidden = false;
  document.body.style.overflow = 'hidden';
  const cible = m.querySelector('input, button:not([data-fermer])');
  if (cible) cible.focus({ preventScroll: true });
}

export function fermerModale(id) {
  const m = id ? document.getElementById(id) : $('.modale:not([hidden])');
  if (!m) return;
  m.hidden = true;
  document.body.style.overflow = '';
  if (derniereFocus) derniereFocus.focus({ preventScroll: true });
  // Certaines actions attendent la fermeture d'une modale (voir exigerCompte).
  document.dispatchEvent(new CustomEvent('preporal:modale-fermee', { detail: { id: m.id } }));
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-fermer]')) fermerModale();
  else if (e.target.classList.contains('modale')) fermerModale();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') fermerModale(); });

/* ── Notifications ─────────────────────────────────────────── */
export function toast(message, ton = 'info') {
  const zone = $('#toasts');
  if (!zone) return;
  const bord = ton === 'erreur' ? 'border-coral/60' : ton === 'succes' ? 'border-mint/60' : 'border-line';
  const el = document.createElement('div');
  el.className = `entree rounded-xl border ${bord} bg-surface px-4 py-3 text-sm shadow-lift`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  zone.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3800);
  setTimeout(() => el.remove(), 4200);
}

/* ── Groupes de boutons « segmented » ──────────────────────── */
export function brancherReglages(etat, auChangement) {
  $$('[data-reglage]').forEach(groupe => {
    const cle = groupe.dataset.reglage;
    const boutons = $$('.opt', groupe);
    const choisir = btn => {
      boutons.forEach(b => {
        const actif = b === btn;
        b.classList.toggle('bg-iris', actif);
        b.classList.toggle('text-white', actif);
        b.classList.toggle('font-semibold', actif);
        b.classList.toggle('text-muted', !actif);
        b.setAttribute('aria-pressed', String(actif));
      });
      const v = btn.dataset.valeur;
      etat[cle] = isNaN(Number(v)) ? v : Number(v);
      auChangement && auChangement(cle, etat[cle]);
    };
    boutons.forEach(b => b.addEventListener('click', () => choisir(b)));
    groupe._choisir = valeur => {
      const btn = boutons.find(b => b.dataset.valeur === String(valeur));
      if (btn) choisir(btn);
    };
    choisir(groupe.querySelector('[data-defaut]') || boutons[0]);
  });
}

export const reglerGroupe = (cle, valeur) => {
  const g = $(`[data-reglage="${cle}"]`);
  if (g && g._choisir) g._choisir(valeur);
};

/* ── Stockage local tolérant (navigation privée, quotas) ───── */
export const stock = {
  lire(cle, defaut = null) {
    try { const v = localStorage.getItem(cle); return v === null ? defaut : JSON.parse(v); }
    catch { return defaut; }
  },
  ecrire(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch { return false; }
  },
  supprimer(cle) { try { localStorage.removeItem(cle); } catch {} }
};
