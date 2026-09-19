/* ═══════════════════════════════════════════════════════════
   fusion.js — réunir l'historique local et l'historique distant

   Les deux ne disent pas la même chose. Le serveur garde une
   trace de progression : type d'oral, note, critères, nombre de
   questions. Il ne garde ni les questions posées, ni les
   réponses, ni la correction — c'est délibéré, et la politique
   de confidentialité le promet.

   Le détail, lui, ne vit que dans le navigateur où la simulation
   a eu lieu.

   La synchronisation écrasait simplement le local par le
   distant. Le détail était donc bien enregistré, puis effacé à
   la première relecture de l'historique : rouvrir une simulation
   ne montrait plus qu'une note, sous un message affirmant
   qu'elle était « antérieure à l'ajout de la relecture ». Elle
   datait de trois minutes.
   ═══════════════════════════════════════════════════════════ */

/* Les identifiants ne peuvent pas servir de clé : le navigateur pose
   « sim_<horodatage> », la base pose le sien. On recoupe donc ce qui ne
   peut pas coïncider par hasard — même type, même note, même nombre de
   questions, à quelques minutes près. Deux simulations du même type
   finissant sur la même note dans le même quart d'heure n'arrivent
   pas : une simulation en dure plusieurs. */
const TOLERANCE = 15 * 60 * 1000;

export const memeSimulation = (a, b) =>
  Boolean(a) && Boolean(b) &&
  a.typeId === b.typeId &&
  a.score === b.score &&
  a.nbQuestions === b.nbQuestions &&
  Math.abs(new Date(a.date) - new Date(b.date)) < TOLERANCE;

/** Ce que seul le navigateur d'origine possède. */
const DETAIL = ['reponses', 'eloquenceDetail', 'verdict', 'tempsTotal', 'details'];

/**
 * Greffe le détail local sur les lignes distantes, et garde les
 * simulations faites ici qui ne sont pas encore remontées.
 *
 * @param {object[]} locales
 * @param {object[]} distantes
 * @param {number}   max
 * @returns {object[]} du plus récent au plus ancien
 */
export function fusionnerHistoriques(locales = [], distantes = [], max = 60) {
  const restantes = [...locales];

  const fusion = distantes.map(d => {
    const i = restantes.findIndex(l => memeSimulation(l, d));
    if (i === -1) return d;
    const [local] = restantes.splice(i, 1);   // une ligne locale ne sert qu'une fois
    const enrichie = { ...d };
    for (const champ of DETAIL) {
      if (local[champ] !== undefined) enrichie[champ] = local[champ];
    }
    return enrichie;
  });

  return [...fusion, ...restantes]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, max);
}
