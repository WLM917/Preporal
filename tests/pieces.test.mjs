/* ═══════════════════════════════════════════════════════════
   tests/pieces.test.mjs

   Les pièces jointes du coach partent vers un modèle facturé
   au jeton, depuis une fonction serverless au corps de requête
   borné. Les garde-fous se testent donc ici, côté serveur :
   celui du navigateur se contourne.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { blocsDePieces, resumerPieces, NOMBRE_PIECES_MAX, TAILLE_PIECE_MAX } =
  await import('../api/_lib/pieces.js');

/** Base64 d'une charge de n octets. */
const charge = n => Buffer.alloc(n, 0x41).toString('base64');

test('un PDF part tel quel : le modèle le lit mieux que nous', () => {
  const blocs = blocsDePieces([
    { type: 'natif', nom: 'sujet.pdf', media: 'application/pdf', donnees: charge(1000) }
  ]);
  assert.equal(blocs.length, 1);
  assert.equal(blocs[0].type, 'document');
  assert.equal(blocs[0].source.type, 'base64');
  assert.equal(blocs[0].source.media_type, 'application/pdf');
});

test('une image devient un bloc image, pas un document', () => {
  for (const media of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    const [bloc] = blocsDePieces([{ type: 'natif', nom: 'copie', media, donnees: charge(500) }]);
    assert.equal(bloc.type, 'image', `${media} doit produire un bloc image`);
    assert.equal(bloc.source.media_type, media);
  }
});

test('un texte déjà extrait arrive nommé', () => {
  const [bloc] = blocsDePieces([{ type: 'texte', nom: 'offre.docx', texte: 'Chargé de communication, CDI.' }]);
  assert.equal(bloc.type, 'text');
  assert.match(bloc.text, /offre\.docx/, 'le nom du document doit accompagner son contenu');
  assert.match(bloc.text, /Chargé de communication/);
});

test('un format que le modèle ne lit pas est refusé, pas transmis', () => {
  assert.throws(
    () => blocsDePieces([{ type: 'natif', nom: 'archive.zip', media: 'application/zip', donnees: charge(100) }]),
    /pris en charge/i);
});

test('une pièce trop lourde est refusée avant l\'appel au modèle', () => {
  assert.throws(
    () => blocsDePieces([{ type: 'natif', nom: 'gros.pdf', media: 'application/pdf',
                          donnees: charge(TAILLE_PIECE_MAX + 1024) }]),
    /trop lourd/i);
});

test('le cumul est borné, pas seulement chaque pièce', () => {
  /* Cinq fichiers de 2,5 Mo passent la borne individuelle mais
     dépassent largement ce qu'une fonction serverless accepte. */
  const grosse = { type: 'natif', nom: 'p.pdf', media: 'application/pdf', donnees: charge(2.5 * 1024 * 1024) };
  assert.throws(() => blocsDePieces([grosse, grosse, grosse]), /total/i);
});

test('le nombre de pièces est borné', () => {
  const une = { type: 'texte', nom: 'n.txt', texte: 'bonjour tout le monde' };
  assert.throws(() => blocsDePieces(Array(NOMBRE_PIECES_MAX + 1).fill(une)), /maximum/i);
});

test('aucune pièce donne aucun bloc', () => {
  assert.deepEqual(blocsDePieces([]), []);
  assert.deepEqual(blocsDePieces(), []);
  assert.deepEqual(blocsDePieces(null), []);
});

test('le journal ne contient jamais le contenu des pièces', () => {
  /* Un CV ou une copie annotée n'a rien à faire dans les journaux
     d'une plateforme d'hébergement. */
  const resume = resumerPieces([
    { type: 'texte', nom: 'cv.docx', texte: 'Camille Dupont, 12 rue des Lilas, 06 12 34 56 78' },
    { type: 'natif', nom: 'sujet.pdf', media: 'application/pdf', donnees: charge(100) }
  ]);
  assert.ok(!resume.includes('Camille'), 'le journal ne doit pas porter le contenu');
  assert.ok(!resume.includes('Dupont'));
  assert.ok(!resume.includes('rue des Lilas'));
  assert.match(resume, /application\/pdf/);
});
