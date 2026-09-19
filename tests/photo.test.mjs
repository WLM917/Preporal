/* ═══════════════════════════════════════════════════════════
   tests/photo.test.mjs

   « supprime moi ce w Cache le moi, fais moi quelque chose,
   dégage » — quatre demandes pour le même gros W au milieu de la
   page. La cause tenait en une ligne : le site prenait le
   monogramme fabriqué par Google pour une photo choisie par le
   candidat.

   Ces tests existent pour que ce W ne puisse plus revenir en
   silence.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estPhotoDeposee } from '../js/photo.js';

test('une photo déposée dans notre stockage en est une', () => {
  assert.equal(estPhotoDeposee(
    'https://kcebxepykavnamtxosbc.supabase.co/storage/v1/object/public/avatars/u1/photo-1.jpg'),
    true);
});

test('une photo gardée dans le compte en est une aussi', () => {
  /* Le repli, quand le stockage n'est pas activé : la photo voyage en
     clair dans les métadonnées du compte. */
  assert.equal(estPhotoDeposee('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='), true);
  assert.equal(estPhotoDeposee('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(estPhotoDeposee('data:image/webp;base64,UklGRh4='), true);
});

test('le monogramme fabriqué par Google n’en est pas une', () => {
  /* Le cœur du sujet. Ces adresses reviennent d'un compte Google sans
     photo, et rien dans leur forme ne les distingue d'une vraie. */
  for (const adresse of [
    'https://lh3.googleusercontent.com/a/ACg8ocJ-monogramme=s96-c',
    'https://lh3.googleusercontent.com/a-/AOh14Gh_lettre_W',
    'https://avatars.githubusercontent.com/u/324954941?v=4'
  ]) {
    assert.equal(estPhotoDeposee(adresse), false, `${adresse} ne doit pas passer`);
  }
});

test('rien du tout n’est pas une photo', () => {
  for (const valeur of ['', null, undefined, 0, false, {}, []]) {
    assert.equal(estPhotoDeposee(valeur), false);
  }
});

test('une adresse qui imite la nôtre ne passe pas', () => {
  /* La photo est affichée dans une balise img : une adresse contrôlée
     par quelqu'un d'autre ferait partir une requête vers son serveur à
     chaque ouverture de la page, avec l'adresse de la page en
     référent. On exige donc notre forme exacte, ancrée au début. */
  for (const adresse of [
    'https://ailleurs.example/x?u=https://s.supabase.co/storage/v1/object/public/avatars/a.jpg',
    'http://s.supabase.co/storage/v1/object/public/avatars/a.jpg',
    'javascript:alert(1)//storage/v1/object/public/avatars/',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
  ]) {
    assert.equal(estPhotoDeposee(adresse), false, `${adresse} ne doit pas passer`);
  }
});

test('un « data: » mal formé ne passe pas pour une image', () => {
  assert.equal(estPhotoDeposee('data:image/jpeg;base64,'), false, 'sans contenu');
  assert.equal(estPhotoDeposee('data:image/jpeg;base64,abc"onerror=x'), false,
    'le contenu doit être du base64 et rien d\'autre');
});

/* ═══ Faire tenir une photo dans un budget ═══════════════════ */

import { ajusterAuBudget } from '../js/photo.js';

const BORNES = { budget: 100, qualites: [0.7, 0.5, 0.3], cote: 128, coteDernier: 96 };

/** Un rendu de papier : le poids baisse avec la qualité et la taille. */
const rendeur = (poidsA128 = {}) => {
  const appels = [];
  const rendre = (cote, qualite) => {
    appels.push({ cote, qualite });
    const cle = `${cote}@${qualite}`;
    return 'x'.repeat(poidsA128[cle] ?? Math.round(cote * qualite * 4));
  };
  return { rendre, appels };
};

test('la première qualité qui tient est retenue', () => {
  const { rendre, appels } = rendeur({ '128@0.7': 150, '128@0.5': 80, '128@0.3': 20 });
  const rendu = ajusterAuBudget(rendre, BORNES);

  assert.equal(rendu.length, 80, 'on garde la meilleure qualité qui rentre');
  assert.deepEqual(appels.map(a => a.qualite), [0.7, 0.5],
    'on ne descend pas plus bas que nécessaire');
});

test('rien qui dépasse le budget n’est jamais rendu', () => {
  /* La propriété qui compte vraiment : si ce qui sort dépasse, le jeton
     devient trop gros et c'est tout le site qui tombe, pas la photo. */
  for (const poids of [
    { '128@0.7': 500, '128@0.5': 400, '128@0.3': 300, '96@0.3': 250 },
    { '128@0.7': 101, '128@0.5': 101, '128@0.3': 101, '96@0.3': 101 }
  ]) {
    const { rendre } = rendeur(poids);
    const rendu = ajusterAuBudget(rendre, BORNES);
    assert.equal(rendu, null, 'aucun rendu ne tient : il faut le dire, pas en rendre un');
  }
});

test('le dernier recours réduit aussi la taille', () => {
  const { rendre, appels } = rendeur({
    '128@0.7': 500, '128@0.5': 400, '128@0.3': 300, '96@0.3': 90 });
  const rendu = ajusterAuBudget(rendre, BORNES);

  assert.equal(rendu.length, 90);
  assert.equal(appels[appels.length - 1].cote, 96,
    'quand la qualité ne suffit plus, on réduit les dimensions');
});

test('une photo qui tient du premier coup ne passe qu’une fois', () => {
  const { rendre, appels } = rendeur({ '128@0.7': 50 });
  assert.equal(ajusterAuBudget(rendre, BORNES).length, 50);
  assert.equal(appels.length, 1, 'inutile de recompresser ce qui rentre déjà');
});

test('un rendu exactement à la limite est accepté', () => {
  const { rendre } = rendeur({ '128@0.7': 100 });
  assert.equal(ajusterAuBudget(rendre, BORNES).length, 100,
    'la borne est un maximum, pas un interdit');
});
