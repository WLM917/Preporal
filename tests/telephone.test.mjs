/* ═══════════════════════════════════════════════════════════
   tests/telephone.test.mjs

   Supabase n'accepte qu'un numéro au format E.164. Un « 06 12
   34 56 78 » enregistré tel quel se refuse au moment d'envoyer
   le SMS, c'est-à-dire trop tard pour le candidat.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* compte.js touche au DOM au chargement : on extrait les deux fonctions
   pures plutôt que d'importer le module entier dans Node. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(RACINE, 'js', 'compte.js'), 'utf8');

const extraire = nom => {
  const debut = source.indexOf(`export function ${nom}`);
  assert.ok(debut > -1, `${nom} doit rester exportée`);
  const fin = source.indexOf('\n}', debut) + 2;
  return source.slice(debut, fin).replace('export ', '');
};

const { normaliserTelephone, afficherTelephone } = await import(
  'data:text/javascript,' + encodeURIComponent(
    extraire('normaliserTelephone') + '\n' + extraire('afficherTelephone') +
    '\nexport { normaliserTelephone, afficherTelephone };' +
    "\nconst INDICATIF_DEFAUT = '+33';"));

test('un numéro français national devient international', () => {
  for (const saisi of ['0780607050', '07 80 60 70 50', '07.80.60.70.50', '07-80-60-70-50', ' 0780607050 ']) {
    assert.equal(normaliserTelephone(saisi), '+33780607050', `échec sur « ${saisi} »`);
  }
});

test('un numéro déjà international est conservé', () => {
  assert.equal(normaliserTelephone('+33780607050'), '+33780607050');
  assert.equal(normaliserTelephone('+33 7 80 60 70 50'), '+33780607050');
  assert.equal(normaliserTelephone('+1 202 555 0143'), '+12025550143');
});

test('un champ vidé reste vide : effacer son numéro est un choix', () => {
  assert.equal(normaliserTelephone(''), '');
  assert.equal(normaliserTelephone('   '), '');
  assert.equal(normaliserTelephone(null), '');
  assert.equal(normaliserTelephone(undefined), '');
});

test('un numéro douteux est refusé plutôt que deviné', () => {
  /* Sept chiffres sans indicatif pourraient appartenir à n'importe
     quel pays : refuser vaut mieux qu'inventer le mauvais. */
  for (const mauvais of ['1234567', 'abcdefgh', '+33', '0', '060708']) {
    assert.equal(normaliserTelephone(mauvais), '', `« ${mauvais} » aurait dû être refusé`);
  }
});

test('un numéro français commençant par 00 n\'est pas pris pour un national', () => {
  assert.equal(normaliserTelephone('0080607050'), '', 'un indicatif 0 n\'existe pas');
});

test('l\'affichage regroupe les chiffres, sans altérer la valeur', () => {
  assert.equal(afficherTelephone('+33780607050'), '+33 7 80 60 70 50');
  // Un numéro étranger reste tel quel plutôt que d'être mal découpé.
  assert.equal(afficherTelephone('+12025550143'), '+12025550143');
  assert.equal(afficherTelephone(''), '');
});

test('normaliser deux fois ne change rien', () => {
  const une = normaliserTelephone('06 12 34 56 78');
  assert.equal(normaliserTelephone(une), une, 'la normalisation doit être idempotente');
});
