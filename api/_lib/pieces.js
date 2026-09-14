/* ═══════════════════════════════════════════════════════════
   api/_lib/pieces.js — pièces jointes du coach

   Deux chemins, choisis selon ce que le modèle sait faire :

   • PDF et images partent tels quels. Le modèle les lit
     nativement, y compris une photo de copie annotée ou un
     sujet manuscrit — bien mieux qu'une reconnaissance de
     caractères faite dans le navigateur.
   • Tout le reste (DOCX, TXT, MD…) arrive déjà converti en
     texte par le navigateur : le modèle ne lit pas le DOCX,
     et mammoth le fait très bien côté client.

   Les tailles sont bornées deux fois, ici et dans le
   navigateur. Celle-ci fait foi : le navigateur, lui, se
   contourne.
   ═══════════════════════════════════════════════════════════ */

import { ErreurIA } from './ia.js';

/** Formats que le modèle lit directement. */
const IMAGES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const PDF = 'application/pdf';

/* Une fonction serverless reçoit au plus quelques mégaoctets de corps,
   et le base64 gonfle de 33 %. On reste franchement en dessous, et on
   plafonne aussi le nombre de pièces : dix PDF de vingt pages
   coûteraient une fortune en jetons sans rien apporter. */
export const TAILLE_PIECE_MAX = 3 * 1024 * 1024;   // 3 Mo par pièce, avant base64
export const TOTAL_PIECES_MAX = 4 * 1024 * 1024;   // 4 Mo cumulés
export const NOMBRE_PIECES_MAX = 5;
const TEXTE_PIECE_MAX = 40000;                     // caractères, pour le texte déjà extrait

const tailleBase64 = b64 => Math.floor((String(b64).length * 3) / 4);

/**
 * Transforme les pièces reçues du navigateur en blocs de contenu.
 * @param {Array<{type:string, nom?:string, media?:string, donnees?:string, texte?:string}>} pieces
 * @returns {Array} blocs prêts à être placés AVANT le texte du message
 */
export function blocsDePieces(pieces = []) {
  if (!Array.isArray(pieces) || !pieces.length) return [];
  if (pieces.length > NOMBRE_PIECES_MAX) {
    throw new ErreurIA(`Cinq pièces jointes au maximum par message.`, 400);
  }

  const blocs = [];
  let cumul = 0;

  for (const piece of pieces) {
    if (!piece || typeof piece !== 'object') continue;
    const nom = String(piece.nom || 'document').slice(0, 120);

    /* ─ Texte déjà extrait par le navigateur ─ */
    if (piece.type === 'texte') {
      const texte = String(piece.texte || '').trim();
      if (!texte) continue;
      if (texte.length > TEXTE_PIECE_MAX) {
        throw new ErreurIA(
          `« ${nom} » est trop long (${texte.length} caractères, ${TEXTE_PIECE_MAX} au maximum). Envoyez la partie qui vous intéresse.`, 413);
      }
      cumul += texte.length;
      blocs.push({ type: 'text', text: `Document joint « ${nom} » :\n\n${texte}` });
      continue;
    }

    /* ─ PDF et images, lus nativement par le modèle ─ */
    const media = String(piece.media || '');
    const donnees = String(piece.donnees || '');
    if (!donnees) continue;

    const octets = tailleBase64(donnees);
    if (octets > TAILLE_PIECE_MAX) {
      throw new ErreurIA(
        `« ${nom} » pèse trop lourd (${Math.round(octets / 1024 / 1024 * 10) / 10} Mo, 3 Mo au maximum).`, 413);
    }
    cumul += octets;
    if (cumul > TOTAL_PIECES_MAX) {
      throw new ErreurIA('Vos pièces jointes dépassent 4 Mo au total.', 413);
    }

    if (media === PDF) {
      blocs.push({ type: 'document', source: { type: 'base64', media_type: PDF, data: donnees } });
    } else if (IMAGES.has(media)) {
      blocs.push({ type: 'image', source: { type: 'base64', media_type: media, data: donnees } });
    } else {
      throw new ErreurIA(
        `Format non pris en charge pour « ${nom} ». Envoyez un PDF, une image, un .docx ou du texte.`, 415);
    }
  }

  return blocs;
}

/** Court résumé, pour le journal : jamais le contenu des pièces. */
export function resumerPieces(pieces = []) {
  return (pieces || []).map(p =>
    p?.type === 'texte' ? `texte:${(p.texte || '').length}c` : (p?.media || '?')).join(',');
}
