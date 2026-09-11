/* ═══════════════════════════════════════════════════════════
   i18n.js — langue de l'interface

   Le balisage porte des attributs data-i18n ; ce module remplace
   le contenu au chargement et à chaque changement de langue.
   Le français reste la langue de référence : c'est lui qui est
   écrit dans le HTML, et il sert de repli quand une traduction
   manque — mieux vaut une phrase en français qu'une clé brute.

   Trois points comptent pour l'accessibilité :
   • l'attribut lang de <html> est mis à jour, sans quoi un
     lecteur d'écran prononce l'anglais avec un accent français ;
   • la synthèse vocale suit la langue choisie ;
   • les libellés d'accessibilité (aria-label) sont traduits.
   ═══════════════════════════════════════════════════════════ */

export const LANGUES = {
  fr: { code: 'fr', etiquette: 'Français', drapeau: '🇫🇷', voix: 'fr-FR', htmlLang: 'fr' },
  en: { code: 'en', etiquette: 'English',  drapeau: '🇬🇧', voix: 'en-US', htmlLang: 'en' },
  es: { code: 'es', etiquette: 'Español',  drapeau: '🇪🇸', voix: 'es-ES', htmlLang: 'es' }
};

const CLE = 'oralixia.langue';
const DEFAUT = 'fr';

let courante = DEFAUT;
let dictionnaire = {};
const abonnes = [];

/** Langue retenue : choix explicite, puis langue du navigateur, puis français. */
export function langueInitiale() {
  try {
    const enregistree = localStorage.getItem(CLE);
    if (enregistree && LANGUES[enregistree]) return enregistree;
  } catch {}
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return LANGUES[nav] ? nav : DEFAUT;
}

export const langue = () => courante;
export const infoLangue = () => LANGUES[courante] || LANGUES[DEFAUT];

/**
 * Traduit une clé. Sans traduction, renvoie le repli fourni —
 * en pratique le texte français déjà présent dans la page.
 */
export function t(cle, repli = '') {
  const v = dictionnaire[cle];
  return v === undefined || v === '' ? repli : v;
}

/** Prévenu à chaque changement de langue. */
export const surChangementLangue = fn => { abonnes.push(fn); };

async function chargerDictionnaire(code) {
  if (code === DEFAUT) return {};          // le français est dans le HTML
  try {
    const m = await import(`./langues/${code}.js`);
    return m.default || {};
  } catch (e) {
    console.warn(`Traductions « ${code} » indisponibles`, e);
    return {};
  }
}

/** Applique les traductions au document. */
export function appliquerTraductions(racine = document) {
  // Contenu textuel
  racine.querySelectorAll('[data-i18n]').forEach(el => {
    const cle = el.dataset.i18n;
    // Le texte français d'origine sert de repli : on le mémorise une fois.
    if (el.dataset.i18nFr === undefined) el.dataset.i18nFr = el.innerHTML;
    el.innerHTML = t(cle, el.dataset.i18nFr);
  });

  // Attributs : data-i18n-attr="placeholder:cle,aria-label:autre"
  racine.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(',').forEach(paire => {
      const [attr, cle] = paire.split(':').map(x => x.trim());
      if (!attr || !cle) return;
      const memo = 'i18nAttr' + attr.replace(/[^a-z]/gi, '');
      if (el.dataset[memo] === undefined) el.dataset[memo] = el.getAttribute(attr) || '';
      el.setAttribute(attr, t(cle, el.dataset[memo]));
    });
  });
}

/** Change la langue de l'interface. */
export async function changerLangue(code) {
  if (!LANGUES[code]) code = DEFAUT;
  courante = code;
  dictionnaire = await chargerDictionnaire(code);

  const info = LANGUES[code];
  document.documentElement.lang = info.htmlLang;
  try { localStorage.setItem(CLE, code); } catch {}

  appliquerTraductions();
  abonnes.forEach(fn => { try { fn(code, info); } catch (e) { console.warn(e); } });
}

/** À appeler une fois par page, avant le reste de l'interface. */
export async function initLangue() {
  await changerLangue(langueInitiale());
}
