/* ═══════════════════════════════════════════════════════════
   fusion.js — les règles pures de l'historique

   Réunir le local et le distant, et borner ce qui part en base.

   L'historique appartient au compte : questions posées, réponses
   données et correction remontent en base, et se retrouvent
   depuis n'importe quel appareil.

   Le local reste une copie d'avance — il s'affiche sans attendre
   le réseau, et garde ce qui n'a pas encore pu remonter. Les deux
   listes se réunissent donc au lieu que l'une écrase l'autre : la
   synchronisation remplaçait le local par le distant, et le
   détail disparaissait à la première relecture.
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


/* ── Ce qui part en base ────────────────────────────────────
   Une réponse dictée fait quelques centaines de mots. Rien
   n'empêche pourtant d'en coller cinquante mille : le champ est
   libre, et c'est la base du service qui le porterait ensuite à
   chaque relecture. On borne donc, largement — huit mille
   caractères, soit une dizaine de minutes de parole — plutôt que
   de découvrir la limite le jour où elle coûte cher. */
const CARACTERES_MAX = 8_000;
const REPONSES_MAX = 40;

const couper = (v, max = CARACTERES_MAX) =>
  typeof v === 'string' && v.length > max ? v.slice(0, max) : v;

/**
 * Le détail d'une simulation, ramené à une taille raisonnable.
 * @param {object} entree
 */
export function bornerDetail(entree = {}) {
  return {
    reponses: (entree.reponses || []).slice(0, REPONSES_MAX).map(r => ({
      question: couper(r.question),
      categorie: couper(r.categorie || '', 120),
      texte: couper(r.texte || ''),
      duree: r.duree || 0,
      dureeParole: r.dureeParole || 0
    })),
    eloquenceDetail: entree.eloquenceDetail || null,
    verdict: couper(entree.verdict || ''),
    tempsTotal: entree.tempsTotal || 0,
    details: (entree.details || []).slice(0, REPONSES_MAX)
  };
}

/* ── Ce qui n'a jamais pu remonter ──────────────────────────
   Une simulation peut avoir son détail ici et pas en base :
   réseau coupé au moment de l'enregistrement, colonnes pas
   encore créées, serveur qui a refusé. Rien ne retentait, et ce
   détail restait prisonnier de l'appareil où la simulation avait
   eu lieu — l'historique cessait d'appartenir au compte. */

/** Une entrée porte-t-elle un détail relisible ? */
const aDuDetail = s => Array.isArray(s?.reponses) && s.reponses.length > 0;

/**
 * Les simulations dont le détail existe ici mais manque en base.
 *
 * @param {object[]} fusionnees  le résultat de fusionnerHistoriques
 * @param {object[]} brutes      les lignes telles que la base les a rendues
 * @returns {object[]} à remonter, les plus récentes d'abord
 */
export function aRattraper(fusionnees = [], brutes = []) {
  /* On ne se fie pas au résultat fusionné pour savoir ce que la base
     possède : la fusion vient justement d'y greffer le détail local. */
  const sansDetailEnBase = new Set(
    brutes.filter(b => b && b.id != null && !aDuDetail(b)).map(b => b.id));

  return fusionnees.filter(s => s && sansDetailEnBase.has(s.id) && aDuDetail(s));
}

/**
 * Les simulations de CE compte qui ne sont jamais arrivées en base.
 *
 * aRattraper ne voit que les lignes déjà présentes en base et privées
 * de leur détail. Une simulation dont l'enregistrement a entièrement
 * échoué — réseau coupé, compte pas encore connecté — n'y figure pas :
 * rien ne la reprenait, et elle restait dans ce navigateur pour
 * toujours. Elle se reconnaît à son identifiant, posé par le
 * navigateur ; la base pose un uuid.
 *
 * L'historique local n'est pas cloisonné par compte : sur un navigateur
 * partagé — une tablette de famille, un poste de lycée — il porte aussi
 * les simulations du compte précédent. Les envoyer au compte connecté
 * les lui attribuerait pour de bon, en base. On n'envoie donc que ce
 * qui porte sa marque : une entrée sans propriétaire connu reste ici,
 * lisible, plutôt que d'être attribuée à quelqu'un au hasard.
 *
 * @param {object[]}    fusionnees
 * @param {string|null} compte  l'identifiant du compte connecté
 */
export const jamaisRemontees = (fusionnees = [], compte = null) =>
  fusionnees.filter(s =>
    s && typeof s.id === 'string' && s.id.startsWith('sim_')
    && Boolean(compte) && s.compte === compte);
