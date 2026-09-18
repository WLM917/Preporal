/* ═══════════════════════════════════════════════════════════
   langue.js — langue de rédaction demandée au modèle

   L'interface est traduite côté navigateur, mais tout ce que le
   modèle écrit (questions, correction, réponses du coach) doit
   suivre la même langue, sinon l'utilisateur lit une page en
   anglais dont le contenu reste en français.
   ═══════════════════════════════════════════════════════════ */

const NOMS = { fr: 'français', en: 'anglais', es: 'espagnol' };

/** Nom français de la langue de rédaction — les consignes sont en français. */
export const nomLangue = code => NOMS[code] || NOMS.fr;

/** Phrase à ajouter à une consigne système. */
export const consigneLangue = code =>
  `Rédige intégralement ta réponse en ${nomLangue(code)}, quelle que soit la langue des documents fournis.`;

/**
 * Libellés de critères venus du navigateur : ils servent de clés JSON,
 * donc on les borne. Sans liste valable, on garde celle du serveur.
 */
export function criteresSurs(recus, repli) {
  if (!Array.isArray(recus)) return repli;
  const propres = [...new Set(recus
    .filter(c => typeof c === 'string')
    .map(c => c.replace(/["\\\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(c => c.length >= 2 && c.length <= 60))];
  return propres.length >= 2 && propres.length <= 6 ? propres : repli;
}
