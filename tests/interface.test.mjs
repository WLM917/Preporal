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

/* Chaque page a son module d'entrée : on vérifie le contrat entre les
   deux, page par page, plutôt que globalement — sinon un identifiant
   présent sur une page masquerait son absence sur une autre. */
const PAGES = [
  { fichier: 'index.html',       entree: 'app.js' },
  { fichier: 'simulateur.html',  entree: 'simulateur.js' },
  { fichier: 'temoignages.html', entree: 'temoignages.js' }
];

const lire = f => readFileSync(join(RACINE, f), 'utf8');
const html = lire('index.html');
const modules = readdirSync(join(RACINE, 'js'))
  .filter(f => f.endsWith('.js'))
  .map(f => ({ nom: f, source: readFileSync(join(RACINE, 'js', f), 'utf8') }));

/** Modules atteignables depuis une entrée, en suivant les imports. */
function grappe(entree, vus = new Set()) {
  if (vus.has(entree)) return vus;
  vus.add(entree);
  const src = modules.find(m => m.nom === entree)?.source || '';
  for (const m of src.matchAll(/from\s+'\.\/([a-zA-Z0-9_-]+\.js)'/g)) grappe(m[1], vus);
  return vus;
}

const idsDuHtml = (source = html) => {
  const l = [...source.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]);
  return { liste: l, ensemble: new Set(l) };
};

/* Identifiants dont l'absence ferait RÉELLEMENT planter la page : ceux
   déréférencés sans point d'interrogation — $('#x').valeur lève si
   l'élément manque, $('#x')?.valeur non. Les modules partagés touchent
   volontairement des éléments qui n'existent que sur certaines pages
   (l'espace compte, la jauge de quota) : ces accès-là sont protégés et
   ne doivent pas être exigés partout. */
const idsRequis = (noms = modules.map(m => m.nom)) => {
  const s = new Set();
  for (const { source } of modules.filter(m => noms.includes(m.nom))) {
    for (const m of source.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)\s*\./g)) s.add(m[1]);
    for (const m of source.matchAll(/getElementById\('([a-zA-Z0-9_-]+)'\)\s*\./g)) s.add(m[1]);
    for (const m of source.matchAll(/ouvrirModale\('([a-zA-Z0-9_-]+)'\)/g)) s.add(m[1]);
  }
  return s;
};

for (const { fichier, entree } of PAGES) {
  test(`${fichier} : les identifiants déréférencés sans garde existent`, () => {
    const { ensemble } = idsDuHtml(lire(fichier));
    const attendus = idsRequis([...grappe(entree)]);
    const manquants = [...attendus].filter(id => !ensemble.has(id));
    assert.deepEqual(manquants, [], `absents de ${fichier} : ${manquants.join(', ')}`);
  });

  test(`${fichier} : aucun identifiant dupliqué`, () => {
    const { liste } = idsDuHtml(lire(fichier));
    const vus = new Set(), doublons = new Set();
    liste.forEach(id => (vus.has(id) ? doublons.add(id) : vus.add(id)));
    assert.deepEqual([...doublons], [], 'un identifiant dupliqué casse querySelector');
  });
}

test('les écrans et vues construits par interpolation existent', () => {
  const simulateur = lire('simulateur.html');
  // simulateur.js les construit ainsi : '#ecran-' + nom.
  for (const e of ['accueil', 'chargement', 'simulation', 'rapport']) {
    assert.ok(simulateur.includes(`id="ecran-${e}"`), `écran ${e} absent de simulateur.html`);
  }
  // app.js fait de même avec '#vue-' + nom.
  for (const v of ['accueil', 'coach', 'compte']) {
    assert.ok(html.includes(`id="vue-${v}"`), `vue ${v} absente d'index.html`);
  }
  // brancherReglages exige une option par défaut dans chaque groupe.
  assert.equal((simulateur.match(/data-defaut/g) || []).length, 3);
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

test('le domaine est identique dans la page, robots.txt et le plan du site', () => {
  /* Une balise canonique qui pointe ailleurs que le site réel dit aux moteurs
     « la vraie version est là-bas » : c'est le meilleur moyen de se
     désindexer soi-même. Les trois fichiers doivent parler du même domaine. */
  const robots = readFileSync(join(RACINE, 'robots.txt'), 'utf8');
  const sitemap = readFileSync(join(RACINE, 'sitemap.xml'), 'utf8');

  const canonique = html.match(/<link rel="canonical" href="(https:\/\/[^/"]+)/)?.[1];
  assert.ok(canonique, 'balise canonique absente');

  const hote = u => (u.match(/https:\/\/([^/"<\s]+)/) || [])[1];
  assert.equal(hote(robots.match(/Sitemap:\s*(\S+)/)[1]), hote(canonique),
    'robots.txt annonce un autre domaine que la balise canonique');
  assert.equal(hote(sitemap.match(/<loc>([^<]+)<\/loc>/)[1]), hote(canonique),
    'sitemap.xml annonce un autre domaine que la balise canonique');

  for (const balise of ['og:url', 'og:image', 'twitter:image']) {
    const m = html.match(new RegExp(`(?:property|name)="${balise}" content="(https://[^/"]+)`));
    if (m) assert.equal(hote(m[1]), hote(canonique), `${balise} pointe vers un autre domaine`);
  }
});

test('le domaine déclaré n\'est pas un exemple resté en place', () => {
  const canonique = html.match(/<link rel="canonical" href="(https:\/\/[^/"]+)/)?.[1] || '';
  for (const factice of ['example.com', 'votre-domaine', 'localhost', 'preporal.fr']) {
    assert.ok(!canonique.includes(factice), `domaine non renseigné : ${canonique}`);
  }
});

test('aucun tarif n\'est écrit en dur dans les pages', () => {
  /* Les prix ne vivent que dans config.js, et la modale d'offre est
     rendue à partir de là. Un tarif recopié dans le HTML finit par
     diverger de celui réellement facturé — ce qui est une pratique
     commerciale trompeuse, et ce qui est déjà arrivé sur ce projet
     lors d'un remaniement des pages. */
  const tarif = /\b\d{1,3},\d{2}\s*€/g;
  for (const { fichier } of PAGES) {
    const trouves = [...lire(fichier).matchAll(tarif)].map(m => m[0]);
    assert.deepEqual(trouves, [],
      `${fichier} contient des tarifs en dur : ${trouves.join(', ')}`);
  }
});

test('les trois offres sont cohérentes entre elles', async () => {
  globalThis.window = { PREPORAL_ENV: {} };
  const { OFFRES, ORDRE_OFFRES, OFFRE_RECOMMANDEE } = await import('../js/config.js');

  assert.deepEqual(ORDRE_OFFRES, ['pass48', 'mensuel', 'extra']);
  assert.ok(OFFRES[OFFRE_RECOMMANDEE], "l'offre recommandée doit exister");

  const euros = t => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
  const mensuel = euros(OFFRES.mensuel.prix);
  const extra = euros(OFFRES.extra.prix);

  // Une offre longue durée plus chère que son équivalent mensuel n'aurait
  // aucun sens commercial et tromperait l'acheteur.
  assert.ok(extra < mensuel * 6,
    `Extra (${extra} €) doit rester sous six mois d'abonnement (${(mensuel * 6).toFixed(2)} €)`);

  // L'économie annoncée doit être celle réellement consentie.
  const economieReelle = (mensuel * 6 - extra).toFixed(2).replace('.', ',');
  assert.ok(OFFRES.extra.economie.includes(economieReelle),
    `économie annoncée « ${OFFRES.extra.economie} » ≠ ${economieReelle} €`);

  const equivalent = (extra / 6).toFixed(2).replace('.', ',');
  assert.ok(OFFRES.extra.equivalentMensuel.includes(equivalent),
    `équivalent mensuel annoncé ≠ ${equivalent} €`);
});

test('aucune page ne promet des simulations « sans compte »', async () => {
  /* Un compte est exigé avant la première simulation (EXIGER_CONNEXION,
     exigerCompte()). Promettre le contraire sur la page de vente serait
     une pratique commerciale trompeuse — et la formule y a figuré tant
     que le quota était anonyme, donc elle peut revenir par copier-coller. */
  const promesses = [/sans compte/i, /no account/i, /sin cuenta/i, /sans inscription/i];
  const sources = [
    ...PAGES.map(p => ({ nom: p.fichier, texte: lire(p.fichier) })),
    ...['en', 'es'].map(l => ({ nom: `js/langues/${l}.js`, texte: lire(`js/langues/${l}.js`) }))
  ];

  for (const { nom, texte } of sources) {
    // Les commentaires de code expliquent légitimement pourquoi un compte
    // est nécessaire : on ne teste que ce qui est affiché.
    const visible = nom.endsWith('.js')
      ? texte.replace(/^\s*\/\*[\s\S]*?\*\//m, '')
      : texte.replace(/<!--[\s\S]*?-->/g, '');
    for (const p of promesses) {
      assert.ok(!p.test(visible), `${nom} promet encore une simulation ${p}`);
    }
  }
});

test('les traductions couvrent toutes les clés du balisage', async () => {
  /* Une clé présente dans le HTML mais absente d'un dictionnaire
     retombe silencieusement sur le français : la page devient un
     mélange des deux langues, ce qui est pire qu'une page non
     traduite. On vérifie donc la couverture, pas seulement la
     validité des fichiers. */
  const cles = new Set();
  for (const { fichier } of PAGES) {
    for (const m of lire(fichier).matchAll(/data-i18n="([^"]+)"/g)) cles.add(m[1]);
    for (const m of lire(fichier).matchAll(/data-i18n-attr="([^"]+)"/g)) {
      m[1].split(',').forEach(p => { const c = p.split(':')[1]; if (c) cles.add(c.trim()); });
    }
  }
  assert.ok(cles.size > 100, `trop peu de chaînes marquées : ${cles.size}`);

  for (const langue of ['en', 'es']) {
    const dico = (await import(`../js/langues/${langue}.js`)).default;
    const manquantes = [...cles].filter(c => !(c in dico));
    assert.deepEqual(manquantes.slice(0, 8), [],
      `${langue} : ${manquantes.length} clé(s) sans traduction`);

    const vides = Object.entries(dico).filter(([, v]) => !String(v).trim());
    assert.deepEqual(vides.map(([k]) => k), [], `${langue} : traductions vides`);
  }
});

test('chaque langue déclare ce qu\'il faut pour la voix et le balisage', async () => {
  const { LANGUES } = await import('../js/i18n.js');
  for (const [code, l] of Object.entries(LANGUES)) {
    assert.equal(l.code, code);
    // Sans htmlLang, un lecteur d'écran prononce la page avec le mauvais accent.
    assert.match(l.htmlLang, /^[a-z]{2}$/, `${code} : htmlLang invalide`);
    // Sans voix, la synthèse vocale lirait l'anglais avec un accent français.
    assert.match(l.voix, /^[a-z]{2}-[A-Z]{2}$/, `${code} : code de voix invalide`);
    assert.ok(l.etiquette && l.drapeau, `${code} : libellé ou drapeau manquant`);
  }
});
