/* ═══════════════════════════════════════════════════════════
   tests/cout.test.mjs

   Le README demande de mesurer le coût par simulation avant
   d'arrêter le prix. Encore faut-il que le calcul soit juste :
   à 9,99 €/mois, une erreur d'un facteur dix sur l'estimation
   change la viabilité du modèle économique.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimerCout } from '../api/_lib/ia.js';

test('le coût suit les tarifs publiés', () => {
  // Opus 5 : 5 $ / M en entrée, 25 $ / M en sortie.
  const c = estimerCout('claude-opus-5', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(Math.round(c * 100) / 100, 5);

  const d = estimerCout('claude-opus-5', { input_tokens: 0, output_tokens: 1_000_000 });
  assert.equal(Math.round(d * 100) / 100, 25);
});

test('les jetons lus en cache sont comptés en entrée', () => {
  const a = estimerCout('claude-opus-5', { input_tokens: 500_000, cache_read_input_tokens: 500_000 });
  const b = estimerCout('claude-opus-5', { input_tokens: 1_000_000 });
  assert.equal(a, b);
});

test('un modèle inconnu ne renvoie pas un chiffre inventé', () => {
  assert.equal(estimerCout('modele-maison', { input_tokens: 1000 }), null);
});

test('sonnet est bien moins cher qu\'opus', () => {
  const u = { input_tokens: 20_000, output_tokens: 2_000 };
  const opus = estimerCout('claude-opus-5', u);
  const sonnet = estimerCout('claude-sonnet-5', u);
  assert.ok(sonnet < opus);
  assert.equal(Math.round((opus / sonnet) * 10) / 10, 2.5, 'rapport annoncé dans le README');
});

test('ordre de grandeur d\'une simulation complète', () => {
  /* Une simulation = 2 appels. Ordres de grandeur observés :
     questions ≈ 14 000 jetons d'entrée / 900 de sortie,
     correction ≈ 9 000 / 2 000. */
  const questions = estimerCout('claude-opus-5', { input_tokens: 14_000, output_tokens: 900 });
  const correction = estimerCout('claude-opus-5', { input_tokens: 9_000, output_tokens: 2_000 });
  const total = questions + correction;

  // Le test verrouille l'ordre de grandeur : quelques centimes, pas quelques euros.
  assert.ok(total > 0.05 && total < 0.30, `coût par simulation hors des clous : ${total.toFixed(3)} $`);

  // À 9,99 € par mois, combien de simulations avant de perdre de l'argent ?
  const seuil = Math.floor(9.99 / total);
  assert.ok(seuil > 30 && seuil < 200, `seuil de rentabilité inattendu : ${seuil} simulations`);
});
