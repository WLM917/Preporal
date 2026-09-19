/* ═══════════════════════════════════════════════════════════
   photo.js — qu'est-ce qu'une vraie photo de profil ?

   La question a l'air oiseuse. Elle a pourtant coûté quatre
   allers-retours.

   Un compte Google sans photo en reçoit une quand même : Google
   en fabrique une, la première lettre du prénom sur un fond
   terne. Rien, dans son adresse, ne la distingue d'une photo que
   le candidat aurait choisie. Le site l'affichait donc en grand
   au milieu de « Gérer mon compte » — le fameux W — et
   verrouillait par-dessus le choix de couleur, au motif qu'une
   photo existait déjà. Un réglage visible sur lequel on ne
   pouvait pas appuyer.

   Pire : une version antérieure recopiait cette image dans
   profils.avatar_url. Elle revenait donc de la base à chaque
   ouverture de session, et écrasait tout.

   D'où cette règle, isolée ici pour qu'on puisse l'éprouver
   seule : n'est une photo que ce que le candidat a lui-même
   déposé. Deux formes, parce qu'il y a deux chemins de dépôt, et
   pas une de plus.
   ═══════════════════════════════════════════════════════════ */

/** Le chemin normal : notre compartiment de stockage. */
const DANS_LE_STOCKAGE = /^https:\/\/[^/]+\/storage\/v1\/object\/public\/avatars\//;

/** Le repli : la photo est gardée en clair dans le compte lui-même,
    faute de stockage activé. Elle n'a pas pu arriver là autrement. */
const DANS_LE_COMPTE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export const estPhotoDeposee = url => {
  const adresse = String(url || '');
  return DANS_LE_STOCKAGE.test(adresse) || DANS_LE_COMPTE.test(adresse);
};

/* ── Faire tenir une photo dans un budget ───────────────────
   Quand le stockage n'est pas activé, la photo est gardée dans
   le compte, donc recopiée dans le jeton d'accès, donc envoyée
   en en-tête à chaque requête. Au-delà de quelques kilooctets,
   l'en-tête dépasse ce que les serveurs acceptent et c'est tout
   le site qui tombe — pas seulement la photo.

   On ne peut pas déduire le poids d'un JPEG de ses dimensions :
   un portrait sur fond uni et une photo de foule ne pèsent pas
   du tout pareil au même format. On essaie donc, et on mesure. */

/**
 * @param {(cote:number, qualite:number) => string} rendre
 * @param {{budget:number, qualites:number[], cote:number, coteDernier:number}} bornes
 * @returns {string|null} le premier rendu qui tient, ou null si aucun.
 */
export function ajusterAuBudget(rendre, { budget, qualites, cote, coteDernier }) {
  for (const qualite of qualites) {
    const rendu = rendre(cote, qualite);
    if (rendu.length <= budget) return rendu;
  }

  // Dernier recours : plus petit encore, à la qualité la plus basse.
  const dernier = rendre(coteDernier, qualites[qualites.length - 1]);
  return dernier.length <= budget ? dernier : null;
}
