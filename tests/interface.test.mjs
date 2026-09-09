/* ═══════════════════════════════════════════════════════════
   tests/interface.test.mjs

   Le front est du HTML statique piloté par des modules ES qui
   retrouvent leurs éléments par identifiant. Une refonte de la
   page peut donc casser le JavaScript sans qu'aucune erreur de
   syntaxe n'apparaisse. Ce test relie les deux.

   Il garde aussi la promesse commerciale : aucun avis fictif,
   aucune note moyenne inventée dans le HTML livré.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(RACINE, 'index.html'), 'utf8');
const modules = readdirSync(join(RACINE, 'js'))
  .filter(f => f.endsWith('.js'))
  .map(f => ({ nom: f, source: readFileSync(join(RACINE, 'js', f), 'utf8') }));

const idsDuHtml = () => {
  const l = [...html.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);
  return { liste: l, ensemble: new Set(l) };
};

/** Identifiants recherchés en dur par les modules : $('#x') et getElementById('x'). */
const idsDuJs = () => {
  const s = new Set();
  for (const { source } of modules) {
    for (const m of source.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)) s.add(m[1]);
    for (const m of source.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)/g)) s.add(m[1]);
    for (const m of source.matchAll(/ouvrirModale\('([a-zA-Z0-9_-]+)'\)/g)) s.add(m[1]);
  }
  return s;
};

test('chaque identifiant attendu par le JavaScript existe dans la page', () => {
  const { ensemble } = idsDuHtml();
  const manquants = [...idsDuJs()].filter(id => !ensemble.has(id));
  assert.deepEqual(manquants, [], `identifiants absents d'index.html : ${manquants.join(', ')}`);
});

test('aucun identifiant n\'est dupliqué', () => {
  const { liste } = idsDuHtml();
  const vus = new Set(), doublons = new Set();
  liste.forEach(id => (vus.has(id) ? doublons.add(id) : vus.add(id)));
  assert.deepEqual([...doublons], [], 'un identifiant dupliqué casse querySelector');
});

test('les écrans, vues et groupes de réglages composés existent', () => {
  // app.js les construit par interpolation : '#ecran-' + nom, '#vue-' + nom.
  for (const e of ['accueil', 'chargement', 'simulation', 'rapport']) {
    assert.ok(html.includes(`id="ecran-${e}"`), `écran ${e} absent`);
  }
  for (const v of ['simulateur', 'coach', 'compte']) {
    assert.ok(html.includes(`id="vue-${v}"`), `vue ${v} absente`);
  }
  for (const r of ['nbQuestions', 'duree', 'niveau']) {
    assert.ok(html.includes(`data-reglage="${r}"`), `réglage ${r} absent`);
  }
  // brancherReglages exige une option par défaut dans chaque groupe.
  assert.equal((html.match(/data-defaut/g) || []).length, 3);
});

test('aucun avis fictif ni note moyenne inventée dans la page livrée', () => {
  // Publier de faux avis ou une note inventée est une pratique commerciale
  // trompeuse (art. L121-2 du code de la consommation).
  for (const motif of [/4,9\s*\/\s*5/, /\+?\s*1[  ]?200\s+oraux/i, /TrustScore/i, /Trustpilot/i]) {
    assert.ok(!motif.test(html), `mention promotionnelle non vérifiable : ${motif}`);
  }
});

test('reviews.js ne contient aucun avis en dur', () => {
  const src = modules.find(m => m.nom === 'reviews.js').source;
  assert.ok(!/const\s+EXEMPLES\s*=/.test(src), 'le tableau d\'avis d\'exemple est revenu');
  assert.ok(/publie/.test(src), 'les avis doivent être filtrés sur publie = true');
});

test('la feuille de styles est servie en statique, sans CDN Tailwind', () => {
  assert.ok(html.includes('assets/tailwind.css'), 'feuille générée non référencée');
  assert.ok(!html.includes('cdn.tailwindcss.com'),
    'le CDN « play » de Tailwind est réservé au développement');
});

test('le thème est appliqué avant le premier rendu', () => {
  // Sinon la page clignote en clair avant de basculer en sombre.
  const avantBody = html.slice(0, html.indexOf('<body'));
  assert.ok(/dataset\.theme|data-theme/.test(avantBody),
    'le script de thème doit précéder <body>');
});

test('aucune clé secrète n\'est présente dans le front', () => {
  const sources = [html, ...modules.map(m => m.source)].join('\n');

  // Clés à préfixe explicite : jamais dans le navigateur.
  for (const s of [/sk_live_[A-Za-z0-9]{8}/, /sk_test_[A-Za-z0-9]{8}/,
                   /sk-ant-[A-Za-z0-9]{8}/, /whsec_[A-Za-z0-9]{8}/]) {
    assert.ok(!s.test(sources), `secret exposé côté navigateur : ${s}`);
  }

  /* Jetons Supabase : la clé « anon » est publique par conception, la clé
     « service_role » contourne les règles RLS et ne doit jamais partir dans
     le navigateur. On lit le rôle dans la charge utile du jeton plutôt que
     de chercher le mot, qui apparaît légitimement dans les commentaires. */
  for (const m of sources.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    let charge;
    try { charge = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); }
    catch { continue; }
    assert.notEqual(charge.role, 'service_role',
      'une clé service_role Supabase est exposée dans le front');
  }
});
