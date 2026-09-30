/* ═══════════════════════════════════════════════════════════
   tests/guides.test.mjs

   Les guides (/guides/*.html) sont les pages qui font venir des
   candidats depuis Google. Un guide absent du plan du site, avec
   une balise canonique fausse ou un lien cassé ne provoque aucune
   erreur visible : il n'est simplement jamais trouvé. Ces tests
   le constatent avant la mise en ligne.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lire = f => readFileSync(join(RACINE, f), 'utf8');

const GUIDES = readdirSync(join(RACINE, 'guides')).filter(f => f.endsWith('.html'));
const sitemap = lire('sitemap.xml');
const hoteSite = lire('index.html').match(/<link rel="canonical" href="(https:\/\/[^/"]+)/)[1];

/* Adresse publique d'un guide : le sommaire est servi sur /guides/. */
const adresse = f => `${hoteSite}/guides/${f === 'index.html' ? '' : f}`;

test('il existe au moins un guide et son sommaire', () => {
  assert.ok(GUIDES.includes('index.html'), 'guides/index.html manque');
  assert.ok(GUIDES.length >= 2, 'aucun guide publié');
});

for (const f of GUIDES) {
  const page = lire(join('guides', f));

  test(`${f} : figure dans sitemap.xml`, () => {
    assert.ok(sitemap.includes(`<loc>${adresse(f)}</loc>`),
      `${adresse(f)} absent du plan du site : Google mettra des semaines à le trouver`);
  });

  test(`${f} : balise canonique vers sa propre adresse`, () => {
    const canonique = page.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    assert.equal(canonique, adresse(f));
    assert.ok(page.includes(`<meta property="og:url" content="${adresse(f)}">`), 'og:url différente de la canonique');
  });

  test(`${f} : titre, description et un seul h1`, () => {
    const titre = page.match(/<title>([^<]+)<\/title>/)?.[1] || '';
    const description = page.match(/<meta name="description" content="([^"]+)"/)?.[1] || '';
    assert.ok(titre.length >= 20, 'titre absent ou trop court');
    assert.ok(description.length >= 80, 'description absente ou trop courte');
    assert.equal((page.match(/<h1[\s>]/g) || []).length, 1, 'il faut exactement un h1');
    assert.match(page, /<html lang="fr"/);
  });

  test(`${f} : mène au simulateur`, () => {
    assert.ok(page.includes('href="/simulateur.html"'), "aucun lien vers le simulateur");
  });

  test(`${f} : feuilles de styles du site, aucun script distant`, () => {
    assert.ok(page.includes('href="/assets/tailwind.css"'));
    assert.ok(page.includes('href="/assets/guides.css"'));
    assert.ok(!/<script[^>]+src=/.test(page), 'un guide ne charge aucun script externe');
  });

  test(`${f} : les liens internes pointent vers des pages qui existent`, () => {
    for (const [, lien] of page.matchAll(/href="(\/[^"#?]*)/g)) {
      const chemin = lien.endsWith('/') ? `${lien}index.html` : lien;
      assert.ok(existsSync(join(RACINE, chemin)), `lien cassé : ${lien}`);
    }
  });

  test(`${f} : données structurées valides`, () => {
    const blocs = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocs.length >= 1, 'aucune donnée structurée');
    for (const [, json] of blocs) {
      const donnees = JSON.parse(json);
      assert.equal(donnees['@context'], 'https://schema.org');
      /* Aucune note agrégée : sans avis réels, ce serait une pratique trompeuse. */
      assert.ok(!json.includes('aggregateRating'), 'note agrégée interdite sans avis réels');
    }
  });
}

test('Tailwind lit les guides', () => {
  const config = lire('tailwind.config.cjs');
  assert.ok(config.includes("'./guides/**/*.html'"), 'guides absents du content de tailwind.config.cjs');
});

test('le pied de page de chaque page mène aux guides', () => {
  for (const f of ['index.html', 'simulateur.html', 'temoignages.html', 'compte.html']) {
    assert.ok(lire(f).includes('href="guides/"'), `${f} : lien vers les guides absent du pied de page`);
  }
});
