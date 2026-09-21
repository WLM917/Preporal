/* ═══════════════════════════════════════════════════════════
   tests/fusion.test.mjs

   « La première simulation, les informations de correction n'ont
   pas été enregistrées. »

   Elles l'étaient. La synchronisation les effaçait : le serveur
   ne garde qu'une trace de progression — note, critères, nombre
   de questions — et l'historique local était simplement remplacé
   par cette version appauvrie. Le message affiché ensuite
   accusait le passé (« antérieure à l'ajout de la relecture »)
   d'un bug qui datait de trois minutes.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionnerHistoriques, memeSimulation } from '../js/fusion.js';

const T = '2026-09-19T14:30:00.000Z';
const plus = (ms, base = T) => new Date(new Date(base).getTime() + ms).toISOString();

/** Une simulation complète, telle que le navigateur la garde. */
const locale = (sur = {}) => ({
  id: 'sim_1', date: T, typeId: 'grand-oral', sousChoix: '', score: 55,
  eloquence: 14, nbQuestions: 4, criteres: { 'Maîtrise du sujet': 55 },
  reponses: [{ question: 'Présentez-vous', texte: 'Ma réponse', duree: 90 }],
  eloquenceDetail: { debit: 140 }, verdict: 'Vous y êtes presque', tempsTotal: 400,
  details: ['a'], ...sur
});

/** La même, telle que le serveur la rend : sans rien du détail. */
const distante = (sur = {}) => ({
  id: 'e3b0c442-0000-4000-8000-000000000001', date: plus(1200), typeId: 'grand-oral',
  sousChoix: '', score: 55, eloquence: 14, nbQuestions: 4,
  criteres: { 'Maîtrise du sujet': 55 }, details: [], ...sur
});

test('le détail local survit à la synchronisation', () => {
  const [r] = fusionnerHistoriques([locale()], [distante()]);

  assert.equal(r.reponses.length, 1, 'les réponses doivent rester relisibles');
  assert.equal(r.reponses[0].texte, 'Ma réponse');
  assert.deepEqual(r.eloquenceDetail, { debit: 140 });
  assert.equal(r.verdict, 'Vous y êtes presque');
  assert.equal(r.tempsTotal, 400);
});

test('une simulation faite ailleurs n’invente pas de détail', () => {
  /* Le détail ne quitte jamais l'appareil d'origine : une simulation
     vue depuis un autre téléphone n'a rien à relire, et c'est normal. */
  const [r] = fusionnerHistoriques([], [distante()]);
  assert.equal(r.reponses, undefined);
  assert.equal(r.verdict, undefined);
});

test('une simulation pas encore remontée n’est pas perdue', () => {
  /* Elle vient d'être faite, le serveur ne la connaît pas encore.
     L'écrasement la faisait disparaître de la liste. */
  const fraiche = locale({ id: 'sim_2', date: plus(60_000), score: 71 });
  const r = fusionnerHistoriques([fraiche, locale()], [distante()]);

  assert.equal(r.length, 2);
  assert.ok(r.some(s => s.score === 71), 'la simulation locale doit rester');
});

test('la liste revient du plus récent au plus ancien', () => {
  /* Le cas qui compte : une simulation locale PLUS RÉCENTE que tout ce
     que le serveur connaît. Elle arrive en fin de liste — les lignes
     distantes d'abord, les orphelines ensuite — et seul le tri la
     remet à sa place. Sans lui, la dernière simulation faite apparaît
     tout en bas de « Mes simulations ». */
  const toutefraiche = locale({ id: 'sim_9', date: plus(3_600_000), score: 88 });
  const r = fusionnerHistoriques([locale(), toutefraiche], [distante()]);

  assert.equal(r.length, 2);
  assert.equal(r[0].score, 88, 'la plus récente doit être en tête');

  const dates = r.map(x => new Date(x.date).getTime());
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
});

test('une ligne locale ne sert qu’une fois', () => {
  /* Deux lignes distantes identiques ne doivent pas se partager le même
     détail : la seconde resterait sans réponses, mais la première ne
     doit pas pour autant se dédoubler. */
  const r = fusionnerHistoriques([locale()], [distante(), distante({ id: 'autre' })]);
  const avecDetail = r.filter(s => s.reponses?.length);
  assert.equal(avecDetail.length, 1, 'un seul détail pour une seule simulation locale');
});

test('la limite est respectée', () => {
  const beaucoup = Array.from({ length: 80 }, (_, i) =>
    locale({ id: 'sim_' + i, date: plus(-i * 3_600_000), score: i }));
  assert.equal(fusionnerHistoriques(beaucoup, [], 60).length, 60);
});

test('deux simulations différentes ne sont pas confondues', () => {
  assert.equal(memeSimulation(locale(), distante({ score: 56 })), false, 'note différente');
  assert.equal(memeSimulation(locale(), distante({ typeId: 'entretien' })), false, 'type différent');
  assert.equal(memeSimulation(locale(), distante({ nbQuestions: 5 })), false, 'nombre de questions');
  assert.equal(memeSimulation(locale(), distante({ date: plus(3_600_000) })), false,
    'une heure plus tard, ce n\'est plus la même');
  assert.equal(memeSimulation(null, distante()), false);
});

test('le décalage entre l’horloge du navigateur et celle du serveur est admis', () => {
  /* La date locale est posée par le navigateur, la date distante par la
     base : elles ne coïncident jamais exactement. */
  for (const ecart of [500, 30_000, 5 * 60_000, -2 * 60_000]) {
    assert.equal(memeSimulation(locale(), distante({ date: plus(ecart) })), true,
      `${ecart} ms d'écart doit rester la même simulation`);
  }
});

test('rien à fusionner ne casse rien', () => {
  assert.deepEqual(fusionnerHistoriques(), []);
  assert.deepEqual(fusionnerHistoriques([], []), []);
});

/* ═══ Ce qui part en base ════════════════════════════════════ */

import { bornerDetail } from '../js/fusion.js';

test('une réponse démesurée est coupée avant de partir', () => {
  /* Le champ de réponse est libre : rien n'empêche d'y coller un
     roman. C'est la base du service qui le porterait ensuite, et le
     réseau qui le relirait à chaque ouverture de l'historique. */
  const r = bornerDetail({ reponses: [{ question: 'Q', texte: 'x'.repeat(50_000) }] });

  assert.ok(r.reponses[0].texte.length <= 8_000,
    `coupée à ${r.reponses[0].texte.length} caractères : la borne ne tient pas`);
  assert.ok(r.reponses[0].texte.length >= 8_000 - 1,
    'et pas plus court que nécessaire : une réponse longue reste lisible');
});

test('une réponse normale n’est pas touchée', () => {
  const texte = 'Ma réponse, environ trois cents mots. ' .repeat(20);
  const r = bornerDetail({ reponses: [{ question: 'Q', texte }] });
  assert.equal(r.reponses[0].texte, texte, 'aucune troncature sur un usage réel');
});

test('le nombre de réponses est borné lui aussi', () => {
  const beaucoup = Array.from({ length: 200 }, (_, i) => ({ question: 'Q' + i, texte: 'r' }));
  assert.equal(bornerDetail({ reponses: beaucoup }).reponses.length, 40);
});

test('le détail garde tout ce qui rend une simulation relisible', () => {
  const r = bornerDetail({
    reponses: [{ question: 'Présentez-vous', categorie: 'Parcours', texte: 'Voici', duree: 90, dureeParole: 70 }],
    eloquenceDetail: { debit: 140 }, verdict: 'Vous y êtes presque',
    tempsTotal: 400, details: ['a', 'b']
  });

  assert.deepEqual(r.reponses[0],
    { question: 'Présentez-vous', categorie: 'Parcours', texte: 'Voici', duree: 90, dureeParole: 70 });
  assert.deepEqual(r.eloquenceDetail, { debit: 140 });
  assert.equal(r.verdict, 'Vous y êtes presque');
  assert.equal(r.tempsTotal, 400);
  assert.deepEqual(r.details, ['a', 'b']);
});

test('une entrée vide ne fait pas tomber le bornage', () => {
  const r = bornerDetail();
  assert.deepEqual(r.reponses, []);
  assert.equal(r.verdict, '');
  assert.equal(r.eloquenceDetail, null);
});

/* ═══ Ce qui n'a jamais pu remonter ══════════════════════════ */

import { aRattraper } from '../js/fusion.js';

const enBase = (sur = {}) => ({ id: 'uuid-1', date: T, typeId: 'grand-oral',
  score: 55, nbQuestions: 4, criteres: {}, details: [], ...sur });

test('une simulation dont la base ignore le détail est à rattraper', () => {
  /* Le cas de ta simulation du 19 septembre : son détail est resté sur
     l'iPad, les colonnes n'existaient pas encore. */
  const fusionnee = { ...enBase(), reponses: [{ question: 'Q', texte: 'R' }] };
  const r = aRattraper([fusionnee], [enBase({ reponses: [] })]);

  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'uuid-1');
});

test('une simulation que la base connaît déjà n’est pas renvoyée', () => {
  const avecDetail = { ...enBase(), reponses: [{ question: 'Q', texte: 'R' }] };
  assert.deepEqual(aRattraper([avecDetail], [avecDetail]), [],
    'la renvoyer à chaque chargement serait du trafic pour rien');
});

test('une simulation sans détail nulle part n’est pas rattrapable', () => {
  /* Celle dont l'ancien bug a détruit le détail : il n'existe plus. */
  assert.deepEqual(aRattraper([enBase()], [enBase()]), []);
});

test('une simulation locale jamais remontée n’est pas confondue', () => {
  /* Elle n'a pas d'identifiant en base : c'est l'insertion qui la
     portera, pas le rattrapage. */
  const locale = { id: 'sim_123', date: T, typeId: 'grand-oral', score: 55,
                   nbQuestions: 4, reponses: [{ question: 'Q', texte: 'R' }] };
  assert.deepEqual(aRattraper([locale], [enBase({ reponses: [] })]), []);
});

test('on ne se fie pas au résultat fusionné pour savoir ce que la base a', () => {
  /* La fusion vient justement d'y greffer le détail local : lire le
     détail dans la ligne fusionnée ferait croire que la base l'a. */
  const brute = enBase({ reponses: [] });
  const fusionnee = { ...brute, reponses: [{ question: 'Q', texte: 'R' }] };
  assert.equal(aRattraper([fusionnee], [brute]).length, 1,
    'la comparaison doit porter sur les lignes brutes');
});

test('rien à rattraper ne casse rien', () => {
  assert.deepEqual(aRattraper(), []);
  assert.deepEqual(aRattraper([], []), []);
  assert.deepEqual(aRattraper([null], [null]), []);
});
