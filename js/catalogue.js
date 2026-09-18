/* ═══════════════════════════════════════════════════════════
   catalogue.js — les épreuves, traduites

   config.js décrit les sept épreuves en français : c'est la
   langue de référence du projet, et ce fichier doit rester pur
   (il est lu par des tests qui tournent hors navigateur).

   La traduction se fait donc ici, au moment de l'affichage. Les
   clés sont dérivées de l'identifiant de l'épreuve, et le texte
   français sert de repli : une traduction oubliée affiche du
   français lisible plutôt qu'une clé brute.

   Ce détour existe parce que sans lui, choisir l'anglais
   laissait tout le catalogue en français — les noms d'épreuves,
   les libellés des deux champs, les critères de notation, les
   catégories de questions. C'est-à-dire l'essentiel de ce que
   lit un candidat.
   ═══════════════════════════════════════════════════════════ */

import { TYPES_ORAL, typeParId } from './config.js';
import { t } from './i18n.js';

/** Traduit une liste, index par index : « type.brevet.critere.2 ». */
const liste = (id, genre, valeurs = []) =>
  valeurs.map((v, i) => t(`type.${id}.${genre}.${i}`, v));

/** Traduit les trois libellés d'un champ de dépôt. */
const champ = (id, cote, c) => c && ({
  ...c,
  label: t(`type.${id}.${cote}.label`, c.label),
  aide: t(`type.${id}.${cote}.aide`, c.aide),
  placeholder: t(`type.${id}.${cote}.placeholder`, c.placeholder)
});

/**
 * Une épreuve dans la langue courante.
 *
 * `consigne` n'est pas traduite : elle part vers le modèle, qui
 * reçoit la langue voulue séparément et répond dans celle-ci.
 * La traduire ici reviendrait à traduire une instruction interne.
 */
export function typeTraduit(id) {
  const type = typeParId(id);
  if (!type) return type;

  return {
    ...type,
    nom: t(`type.${type.id}.nom`, type.nom),
    court: t(`type.${type.id}.court`, type.court),
    champA: champ(type.id, 'champA', type.champA),
    champB: champ(type.id, 'champB', type.champB),
    criteres: liste(type.id, 'critere', type.criteres),
    categories: liste(type.id, 'categorie', type.categories),
    sousChoix: type.sousChoix && {
      ...type.sousChoix,
      label: t(`type.${type.id}.souschoix.label`, type.sousChoix.label),
      options: liste(type.id, 'souschoix', type.sousChoix.options)
    }
  };
}

/** Le catalogue entier, traduit. */
export const catalogueTraduit = () => TYPES_ORAL.map(type => typeTraduit(type.id));
