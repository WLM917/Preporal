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
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Chaque page a son module d'entrée : on vérifie le contrat entre les
   deux, page par page, plutôt que globalement — sinon un identifiant
   présent sur une page masquerait son absence sur une autre. */
const PAGES = [
  { fichier: 'index.html',       entree: 'app.js' },
  { fichier: 'simulateur.html',  entree: 'simulateur.js' },
  { fichier: 'temoignages.html', entree: 'temoignages.js' },
  { fichier: 'compte.html',      entree: 'compte.js' }
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

test("l'inscription distingue une adresse déjà inscrite", () => {
  /* signUp répond « succès » avec un utilisateur factice quand l'adresse
     existe déjà, et n'envoie aucun message : Supabase évite ainsi de
     révéler qui possède un compte. Le seul indice est identities, vide.
     Sans ce test, on annonce un e-mail qui ne partira jamais — c'est
     exactement ce qui est arrivé sur ce projet. */
  const src = modules.find(m => m.nom === 'auth.js').source;

  // Le corps d'inscription() lui-même, pas le fichier entier : le drapeau
  // doit naître ici, sinon l'appelant teste une propriété jamais posée.
  const debut = src.indexOf('export async function inscription');
  assert.ok(debut > -1, 'inscription() a disparu');
  const corps = src.slice(debut, src.indexOf('\n}', debut));

  assert.match(corps, /identities/,
    "le cas « adresse déjà inscrite » n'est plus détecté");
  assert.match(corps, /dejaInscrit/,
    'inscription() doit signaler le cas à son appelant');
  assert.match(src.slice(src.indexOf('btnInscrire')), /dejaInscrit/,
    "le formulaire doit traiter le cas au lieu d'annoncer un e-mail");
});

test("les liens d'authentification en échec sont expliqués", () => {
  /* Un lien périmé ou déjà cliqué renvoie #error=…&error_code=otp_expired.
     Ignoré, il dépose le candidat sur l'accueil, déconnecté, sans un mot. */
  const src = modules.find(m => m.nom === 'auth.js').source;
  assert.match(src, /error_code/, "le code d'erreur du lien n'est plus lu");
  for (const code of ['otp_expired', 'access_denied']) {
    assert.ok(src.includes(code), `message manquant pour ${code}`);
  }
});

test("le chargement du client Supabase est borné dans le temps", () => {
  /* Le client vient d'un CDN. Un import qui reste en suspens gèle toute
     l'initialisation : en-tête figé sur « Connexion », menu jamais dessiné. */
  const src = modules.find(m => m.nom === 'auth.js').source;
  assert.match(src, /Promise\.race/, 'le délai de garde a disparu');
});

test('chaque champ de mot de passe peut être révélé', () => {
  /* Un mot de passe qu'on ne peut pas relire se tape deux fois de travers,
     et la confirmation ne fait alors que répéter la faute de frappe. */
  const src = modules.find(m => m.nom === 'auth.js').source;
  const CHAMPS = ['auth-motdepasse', 'inscr-motdepasse', 'inscr-confirmation'];

  assert.match(src, /function brancherOeil/, "la fonction qui pose l'œil a disparu");

  /* On regarde les appels, pas la simple présence des identifiants :
     ceux-ci apparaissent ailleurs dans le fichier, et un test qui se
     contenterait de les chercher resterait vert après suppression du
     câblage — ce qui a été vérifié en cassant volontairement le code. */
  const appels = [...src.matchAll(/brancherOeil\(/g)]
    .map(m => src.slice(Math.max(0, m.index - 200), m.index + 200))
    .filter(bout => !/function brancherOeil/.test(bout.slice(180, 220)))
    .join('\n');
  assert.ok(appels, 'brancherOeil() n\'est jamais appelé');
  for (const id of CHAMPS) {
    assert.ok(appels.includes(`'#${id}'`), `${id} ne reçoit pas d'œil`);
  }
  assert.match(src, /aria-pressed/, "l'œil doit annoncer son état aux lecteurs d'écran");

  // Et les trois champs doivent exister, en type password, sur chaque page.
  for (const { fichier } of PAGES) {
    const page = lire(fichier);
    for (const id of CHAMPS) {
      const balise = page.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      assert.ok(balise, `${id} absent de ${fichier}`);
      assert.match(balise[0], /type="password"/, `${id} n'est pas un champ mot de passe dans ${fichier}`);
    }
  }
});

test("les bibliothèques de lecture de documents sont servies par le site", () => {
  /* Elles venaient d'un CDN : injoignable, l'import de PDF et de DOCX
     restait bloqué sur « Lecture de… » indéfiniment, sans message.
     Reproduit dans un navigateur avant correction. */
  const src = modules.find(m => m.nom === 'upload.js').source;
  for (const fichier of ['pdf.min.js', 'pdf.worker.min.js', 'mammoth.browser.min.js']) {
    assert.ok(existsSync(join(RACINE, 'assets', 'vendor', fichier)),
      `assets/vendor/${fichier} manquant`);
    assert.ok(src.includes(`assets/vendor/${fichier}`),
      `upload.js ne pointe pas sur assets/vendor/${fichier}`);
  }
  assert.ok(!/cdnjs\.cloudflare\.com/.test(src),
    'pdf.js et mammoth ne doivent plus dépendre de cdnjs');

  // Et le chargement doit rester borné, sinon on retrouve le blocage.
  assert.match(src, /DELAI_SCRIPT/, 'le délai de garde du chargement a disparu');
  assert.match(src, /scriptsCharges\.delete/,
    'un échec mémorisé condamnerait l\'import jusqu\'au rechargement');
});

test('les deux champs de documents acceptent la dictée', () => {
  const src = modules.find(m => m.nom === 'upload.js').source;
  assert.match(src, /brancherDicteeChamp/, 'la dictée des champs a disparu');
  assert.match(src, /dicteeSupportee/,
    'un navigateur sans reconnaissance vocale doit être prévenu, pas laissé avec un bouton mort');
  // brancherDepot est appelé pour les deux champs : la dictée suit.
  const sim = modules.find(m => m.nom === 'simulateur.js').source;
  for (const champ of ['champA', 'champB']) {
    assert.ok(sim.includes(`idCible: '${champ}'`), `${champ} n'est plus branché`);
  }
});

test('les CGV décrivent les offres réellement vendues', async () => {
  /* Les tarifs et les conditions de reconduction étaient recopiés à la
     main dans les CGV. L'offre six mois y est restée « paiement unique,
     sans reconduction » alors qu'elle était devenue un abonnement —
     c'est le genre d'écart qui relève de l'art. L121-2. */
  const src = modules.find(m => m.nom === 'legal.js').source;

  assert.match(src, /OFFRES/, 'les CGV doivent lire les offres, pas les recopier');
  const tarif = /\b\d{1,3},\d{2}\s*€/g;
  const enDur = [...src.matchAll(tarif)].map(m => m[0]);
  assert.deepEqual(enDur, [], `tarifs recopiés dans les CGV : ${enDur.join(', ')}`);

  // Toute offre reconduite doit l'annoncer, et rappeler l'art. L215-1.
  globalThis.window = globalThis.window || { PREPORAL_ENV: {} };
  const { OFFRES } = await import('../js/config.js');
  const reconduits = Object.values(OFFRES).filter(o => o.mode === 'subscription');
  assert.ok(reconduits.length, 'au moins une offre est un abonnement');
  assert.match(src, /reconduit automatiquement/,
    'une offre reconduite doit annoncer sa reconduction');
  assert.match(src, /L215-1/,
    "l'information avant reconduction est une obligation légale, elle doit figurer aux CGV");

  // Une offre à essai doit dire ce qu'il advient pendant l'essai.
  if (reconduits.some(o => o.essaiJours > 0)) {
    assert.match(src, /essai/, "les CGV doivent décrire la période d'essai");
  }
});

test("le plan d'un abonnement se lit sur son tarif", () => {
  /* Écrit en dur, « mensuel » étiquetait tout abonné six mois comme
     mensuel dès son premier changement de formule dans le portail. */
  const webhook = readFileSync(join(RACINE, 'api', 'webhook.js'), 'utf8');

  /* On vérifie l'appel, pas l'import : retirer l'appel en laissant
     l'import laissait le test au vert — constaté en cassant le code. */
  assert.match(webhook, /planDeLAbonnement\s*\(/,
    'le plan doit être déduit du tarif souscrit, pas écrit en dur');
  assert.ok(!/\bplan\s*[:=]\s*'mensuel'/.test(webhook),
    'un plan « mensuel » écrit en dur étiquette mal tout abonné six mois');
  assert.match(webhook, /customer\.subscription\.created/,
    "l'abonnement ouvert en essai arrive par « created »");
});

test("un enregistrement qui échoue rend la main et dit pourquoi", () => {
  /* Le bouton restait bloqué sur « Enregistrement… », désactivé, sans
     un mot : une exception traversait sans try/finally, et une requête
     qui ne revenait jamais n'avait aucun délai de garde. Reproduit
     dans un navigateur avant correction. */
  const src = modules.find(m => m.nom === 'compte.js').source;

  /* On isole les deux fonctions concernées : le fichier entier contient
     d'autres finally et d'autres avecDelai, et un test qui regarde le
     fichier restait vert alors que la garde avait sauté — vérifié en
     cassant le code. */
  const corps = nom => {
    const debut = src.indexOf(`function ${nom}`);
    assert.ok(debut > -1, `${nom} a disparu`);
    return src.slice(debut, src.indexOf('\n}', debut));
  };

  const infos = corps('enregistrerInfos');
  /* La propriété qui compte : le bouton redevient utilisable sur les
     DEUX chemins, succès comme échec. Peu importe que ce soit un
     finally ou deux branches — la version précédente de ce test
     exigeait le mot-clé, et serait devenue rouge sur un code correct. */
  const reactivations = [...infos.matchAll(/disabled\s*=\s*false/g)].length;
  assert.ok(reactivations >= 1,
    'le bouton doit redevenir utilisable, sinon il reste bloqué sur « Enregistrement… »');
  assert.match(infos, /catch/,
    'une exception doit devenir un message, pas une console vide');
  assert.match(infos, /marquerEnregistre\(bouton\)/,
    'le succès doit se voir sur le bouton lui-même');

  const succes = corps('marquerEnregistre');
  assert.match(succes, /disabled\s*=\s*false/,
    'le bouton doit être rendu au candidat après un succès aussi');
  assert.match(succes, /setTimeout/,
    'le vert doit s\'effacer tout seul, sinon le bouton ment au prochain passage');

  const ecriture = corps('enregistrer');
  assert.match(ecriture, /avecDelai\s*\(/,
    'sans délai de garde, une requête qui ne revient jamais bloque le bouton');

  /* L'envoi de photo souffrait du même mal, et n'était couvert par
     aucun test : un compartiment injoignable laissait la page sur
     « Envoi de la photo… », sans message et sans fin. */
  const envoi = corps('appelerApiAvatar');
  assert.match(envoi, /avecDelai\s*\(/,
    "l'envoi de la photo doit avoir son propre délai de garde");

  /* Le navigateur ne dépose plus lui-même dans le stockage : il n'a pas
     le droit de créer le compartiment « avatars », et le site se
     contentait donc de dire au candidat d'en avertir l'éditeur. */
  const photo = corps('televerserPhoto');
  assert.doesNotMatch(photo, /supabase\.storage/,
    "le dépôt doit passer par l'API, qui a les droits de créer le compartiment");
  assert.match(envoi, /fetch\(\s*['"`]\/api\/avatar/,
    "l'API du site est le seul chemin d'envoi de photo");

  /* Le stockage n'est pas activé sur tous les sites. Plutôt que de
     renvoyer le candidat vers l'éditeur, la photo est alors gardée dans
     le compte lui-même — réduite pour y tenir. */
  assert.match(photo, /statut\s*!==\s*503[\s\S]{0,200}photoDeRepli/,
    'un stockage inactif doit conduire au repli, et lui seul');
  assert.match(envoi, /erreur\.statut\s*=\s*reponse\.status/,
    "sans le code HTTP, on ne peut pas distinguer « pas activé » d'une vraie panne");

  /* Les métadonnées du compte sont recopiées dans le jeton d'accès, et
     ce jeton part en en-tête à chaque requête. Une photo trop lourde
     rendrait l'en-tête plus gros que ce que les serveurs acceptent. */
  /* La boucle qui fait tenir la photo vit dans js/photo.js, où elle
     s'éprouve pour de bon — poids par poids, sans toile ni navigateur.
     Ici on vérifie seulement que le repli s'en sert et qu'il traite le
     cas où rien ne rentre. */
  const repli = corps('photoDeRepli');
  assert.match(repli, /ajusterAuBudget\(/,
    'le repli doit passer par la fonction éprouvée, pas refaire sa boucle');
  assert.match(repli, /budget:\s*POIDS_REPLI_MAX/,
    'le budget doit être celui que le jeton peut porter');
  assert.match(repli, /if\s*\(!rendu\)[\s\S]{0,120}throw/,
    'une photo qui ne rentre dans aucun format doit le dire, pas être enregistrée quand même');
});

test('une photo de téléphone n’est pas refusée pour son poids d’origine', () => {
  /* Le garde-fou portait sur le fichier CHOISI, à deux mégaoctets. Une
     photo prise avec un iPhone en pèse trois à cinq : le site la
     refusait d'emblée, alors qu'il s'apprêtait à la réduire à quelques
     kilooctets. On refusait une photo pour un poids qu'on allait
     soi-même faire disparaître. */
  const src = modules.find(m => m.nom === 'compte.js').source;
  const ligne = src.split('\n').find(l => l.includes('const TAILLE_PHOTO_MAX'));
  assert.ok(ligne, 'la borne a disparu');

  const mo = Number((ligne.match(/(\d+)\s*\*\s*1024\s*\*\s*1024/) || [])[1]);
  assert.ok(mo >= 10,
    `la borne est à ${mo} Mo : une photo de téléphone n'y entre pas`);
});

test('une photo inaffichable ne condamne pas le choix de couleur', () => {
  /* La photo des comptes Google était refusée par la politique de
     sécurité : la pastille s'affichait vide, et le nuancier restait
     grisé au motif qu'« il y a déjà une photo ». Deux corrections, et
     la seconde compte le plus : une URL de photo n'est pas une photo. */
  const auth = modules.find(m => m.nom === 'auth.js').source;
  const compte = modules.find(m => m.nom === 'compte.js').source;

  assert.match(auth, /photoCassee/, 'l\'échec de chargement doit être détecté');
  assert.match(auth, /addEventListener\('error'[\s\S]{0,120}true\)/,
    'une image en erreur ne remonte pas : il faut écouter en capture');

  // Le nuancier ne se grise que pour une photo réellement affichée.
  assert.match(compte, /session\.avatar\)?\s*&&\s*!photoCassee/,
    'le nuancier doit rester utilisable quand la photo ne s\'affiche pas');

  // Et les hôtes d'avatars doivent être autorisés par la CSP.
  const csp = JSON.parse(readFileSync(join(RACINE, 'vercel.json'), 'utf8'))
    .headers.find(r => r.source === '/(.*)')
    .headers.find(h => h.key === 'Content-Security-Policy').value;
  const imgSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('img-src'));
  assert.match(imgSrc, /googleusercontent\.com/,
    'la photo des comptes Google serait bloquée');
});

test("l'enregistrement n'attend que les métadonnées, pas la copie en base", () => {
  /* Les métadonnées font foi pour l'affichage : c'est d'elles que la
     session se remplit, et ce sont du JSON, donc aucune colonne ne
     peut y manquer. La table « profils » n'en reçoit qu'une copie.

     La copie était attendue, et commandait tout : tant que la base ne
     répondait pas — ou refusait une colonne absente du schéma — le
     candidat regardait « Enregistrement… » jusqu'au délai de garde,
     puis lisait « Le serveur n'a pas répondu », pour un changement de
     pseudonyme déjà enregistré dans son compte. */
  const src = modules.find(m => m.nom === 'compte.js').source;
  const debut = src.indexOf('async function enregistrer(');
  const corps = src.slice(debut, src.indexOf('\n}\n', debut));

  assert.match(corps, /await tenter\('métadonnées'/,
    'les métadonnées sont la seule écriture attendue');
  assert.ok(!/await copierEnBase/.test(corps),
    'attendre la copie fait patienter pour un enregistrement déjà acquis');
  assert.match(corps, /copierEnBase\(colonnes\)\.catch/,
    'la copie part quand même, et son échec ne doit pas remonter en rejet non traité');

  // Une colonne manquante reste rattrapée, sans rien dire au candidat.
  assert.match(corps, /colonneInconnue/, 'le rattrapage de colonne absente a disparu');
});

test('le monogramme fourni par Google ne tient pas lieu de photo', () => {
  /* Un compte Google sans photo reçoit tout de même une image :
     Google en fabrique une, la première lettre du prénom sur un fond
     terne. Rien ne la distingue d'une vraie photo par son URL. Elle
     s'affichait donc en grand au milieu de « Gérer mon compte », et
     verrouillait le choix de couleur au motif qu'une photo existait. */
  const src = modules.find(m => m.nom === 'auth.js').source;

  /* Ne plus lire « picture » dans les métadonnées ne suffisait pas : une
     version précédente l'avait recopié dans profils.avatar_url, d'où il
     revenait à chaque ouverture de session. Il faut donc reconnaître
     une vraie photo à son adresse.

     La règle elle-même vit dans js/photo.js et s'éprouve dans
     tests/photo.test.mjs, cas par cas. Ici, on vérifie seulement
     qu'auth.js s'en sert à chacun des deux endroits où une photo peut
     entrer. */
  assert.match(src, /estPhotoDeposee[\s\S]{0,40}from '\.\/photo\.js'/,
    "auth.js doit s'appuyer sur la règle commune, pas en redéfinir une");

  for (const source of ['m.avatar_url', 'data.avatar_url']) {
    const ligne = src.split('\n').find(l => l.includes('session.avatar =') && l.includes(source));
    assert.ok(ligne, `la reprise de la photo depuis ${source} a disparu`);
    assert.match(ligne, /estPhotoDeposee\(/,
      `${source} doit passer le contrôle : sinon le monogramme du compte revient`);
  }

  assert.ok(!/session\.avatar[^\n]*m\.picture/.test(src),
    "« picture » vient du fournisseur, pas du candidat : il ne doit pas devenir sa photo");
});

test('le choix de couleur reste toujours cliquable', () => {
  /* Il était grisé dès qu'une photo existait. Combiné au monogramme
     Google, cela donnait un réglage visible sur lequel on ne pouvait
     jamais appuyer. */
  const src = modules.find(m => m.nom === 'compte.js').source;
  const debut = src.indexOf('function rendreCouleurs(');
  const corps = src.slice(debut, src.indexOf('\n}', debut));

  assert.ok(!/pointer-events-none/.test(corps),
    'le choix de couleur ne doit jamais être rendu inerte');
  assert.ok(!/opacity-40/.test(corps),
    'le choix de couleur ne doit jamais être grisé');
  assert.match(corps, /data-couleur/, 'les pastilles doivent toujours être rendues');
});

test('la page compte permet de se déconnecter', () => {
  /* Se déconnecter depuis l'écran qui gère le compte est le geste le
     plus attendu : il n'y était pas. */
  const page = lire('compte.html');
  assert.match(page, /id="btn-deconnexion-compte"/, 'bouton de déconnexion absent');
  const src = modules.find(m => m.nom === 'compte.js').source;
  assert.match(src, /btn-deconnexion-compte[\s\S]{0,80}deconnexion/,
    'le bouton doit être branché sur la déconnexion');
});

test('la vérification par SMS a bien été retirée', () => {
  /* Elle imposait un fournisseur payant, facturait chaque tentative, et
     rattachait un champ informatif à l'authentification du compte. */
  const src = modules.find(m => m.nom === 'compte.js').source;
  const page = lire('compte.html');
  for (const trace of ['verifyOtp', 'phone_change', 'code-sms', 'btn-verifier-tel']) {
    assert.ok(!src.includes(trace) && !page.includes(trace),
      `reste de la vérification par SMS : ${trace}`);
  }
});

test("le pseudonyme remplace le nom, il ne s'y ajoute pas", () => {
  /* Le menu et la carte affichaient « WLM_917 MATIABU OMANGELO » :
     le nom de famille accolé au pseudonyme révélait justement
     l'identité que le pseudonyme sert à couvrir. */
  const auth = modules.find(m => m.nom === 'auth.js').source;
  assert.ok(!/nomAffiche\(\)\s*\+\s*\(session\.nom/.test(auth),
    'le nom de famille ne doit plus être accolé au nom affiché');
  assert.match(auth, /nomComplet/,
    'un seul point d\'entrée pour le nom affiché, sinon le cas revient ailleurs');
});

test('le domaine déclaré est celui que CONFIG annonce', async () => {
  /* La balise canonique a pointé sur preporal.vercel.app après que ce
     domaine a cessé de répondre : elle disait donc aux moteurs « la
     vraie version est là-bas », vers un 404. Les pages et CONFIG
     doivent parler du même hôte. */
  globalThis.window = globalThis.window || { ORALIXIA_ENV: {} };
  const { DOMAINE } = await import('../js/config.js');

  const canonique = html.match(/<link rel="canonical" href="https:\/\/([^/"]+)/)?.[1];
  assert.equal(canonique, DOMAINE,
    `la page annonce ${canonique}, CONFIG annonce ${DOMAINE}`);

  for (const factice of ['example.com', 'votre-domaine', 'localhost', 'vercel.app']) {
    assert.ok(!DOMAINE.includes(factice),
      `DOMAINE doit être le domaine définitif, pas ${factice}`);
  }
});

test("le nom du produit n'est écrit qu'à un seul endroit", async () => {
  /* Un changement de marque ne doit pas être une chasse aux
     occurrences : les textes légaux, les e-mails et le titre des PDF
     lisent CONFIG.nomProduit. */
  globalThis.window = globalThis.window || { ORALIXIA_ENV: {} };
  const { CONFIG, NOM_PRODUIT, DOMAINE } = await import('../js/config.js');
  assert.ok(NOM_PRODUIT, 'le nom du produit doit être défini');
  assert.equal(CONFIG.nomProduit, NOM_PRODUIT);
  assert.ok(DOMAINE && !DOMAINE.includes('://'), 'DOMAINE est un hôte, sans protocole');

  // Plus aucune trace de l'ancien nom dans ce qui est livré.
  for (const { fichier } of PAGES) {
    const page = lire(fichier);
    assert.ok(!/PrepOral/.test(page), `ancien nom encore présent dans ${fichier}`);
  }
  for (const { nom, source } of modules) {
    assert.ok(!/PrepOral/.test(source), `ancien nom encore présent dans js/${nom}`);
  }
});

test('les clés de stockage renommées sont reprises, pas perdues', () => {
  /* Le préfixe est passé de « prepOral. » à « oralixia. ». Sans
     reprise, chacun aurait perdu son historique et son quota au
     premier chargement suivant la mise à jour. */
  const ui = modules.find(m => m.nom === 'ui.js').source;
  assert.match(ui, /prepOral\./, 'la migration doit connaître l\'ancien préfixe');
  assert.match(ui, /oralixia\./, 'la migration doit écrire le nouveau préfixe');
  assert.match(ui, /migration/, 'la migration doit être marquée pour ne courir qu\'une fois');
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

test('les traductions couvrent aussi les clés appelées depuis les modules', async () => {
  /* Le test précédent ne lit que le balisage. Or l'essentiel de ce que
     voit un candidat — les messages d'erreur, le rapport, le coach, les
     CGV — est écrit par les modules via t('clé', 'repli'). Une clé
     oubliée y retombe sur le français, et la page devient bilingue sans
     que rien ne le signale. */
  const cles = new Map();                       // clé -> texte français
  const modulesJs = readdirSync(join(RACINE, 'js')).filter(f => f.endsWith('.js'));

  for (const f of modulesJs) {
    const src = readFileSync(join(RACINE, 'js', f), 'utf8');
    // t('clé', 'repli') et pa('clé', 'repli') — le repli peut aller à la ligne.
    const re = /\b(t|pa)\(\s*(['"])([a-zA-Z0-9._-]+)\2\s*,\s*(['"`])((?:\\.|(?!\4)[\s\S])*?)\4\s*[,)]/g;
    for (const m of src.matchAll(re)) {
      const cle = (m[1] === 'pa' ? 'legal.' : '') + m[3];
      if (!cles.has(cle)) cles.set(cle, m[5]);
    }
  }
  assert.ok(cles.size > 250, `trop peu de clés trouvées dans les modules : ${cles.size}`);

  // Aucun repli vide : sans repli, une traduction manquante affiche du blanc.
  const sansRepli = [...cles].filter(([, fr]) => !fr.trim()).map(([c]) => c);
  assert.deepEqual(sansRepli, [], 'clés sans texte français de repli');

  for (const langue of ['en', 'es']) {
    const dico = (await import(`../js/langues/${langue}.js`)).default;
    const manquantes = [...cles.keys()].filter(c => !(c in dico));
    assert.deepEqual(manquantes.slice(0, 8), [],
      `${langue} : ${manquantes.length} clé(s) de module sans traduction`);
  }
});

test('le catalogue des épreuves est traduit dans les deux langues', async () => {
  /* Les sept épreuves vivent dans config.js, en français : leurs noms,
     les libellés des deux champs, les critères de notation et les
     catégories de questions. catalogue.js les traduit par clé dérivée
     de l'identifiant — s'il en manque une, le candidat lit le nom de
     son épreuve en français au milieu d'une page anglaise. */
  globalThis.window = globalThis.window || { ORALIXIA_ENV: {} };
  const { TYPES_ORAL } = await import('../js/config.js');

  const attendues = [];
  for (const ty of TYPES_ORAL) {
    attendues.push(`type.${ty.id}.nom`, `type.${ty.id}.court`);
    for (const cote of ['champA', 'champB']) {
      if (!ty[cote]) continue;
      for (const p of ['label', 'aide', 'placeholder']) attendues.push(`type.${ty.id}.${cote}.${p}`);
    }
    (ty.criteres || []).forEach((_, i) => attendues.push(`type.${ty.id}.critere.${i}`));
    (ty.categories || []).forEach((_, i) => attendues.push(`type.${ty.id}.categorie.${i}`));
    if (ty.sousChoix) {
      attendues.push(`type.${ty.id}.souschoix.label`);
      (ty.sousChoix.options || []).forEach((_, i) => attendues.push(`type.${ty.id}.souschoix.${i}`));
    }
  }

  for (const langue of ['en', 'es']) {
    const dico = (await import(`../js/langues/${langue}.js`)).default;
    const manquantes = attendues.filter(c => !(c in dico));
    assert.deepEqual(manquantes.slice(0, 8), [],
      `${langue} : ${manquantes.length} clé(s) de catalogue sans traduction`);
  }
});

test('les questions de secours sont traduites, sauf les épreuves de langue', async () => {
  /* La banque hors ligne s'affiche quand le modèle est injoignable :
     elle est donc visible, et doit suivre la langue choisie. Exception
     assumée : une certification se passe dans la langue de l'examen,
     seuls les intitulés de catégorie s'y traduisent. */
  const src = readFileSync(join(RACINE, 'js/questions.js'), 'utf8');
  const bloc = src.slice(src.indexOf('const BANQUES = {'), src.indexOf('/** Remplace'));
  assert.ok(bloc.length > 500, 'banques de secours introuvables');

  const attendues = [];
  for (const m of bloc.matchAll(/^  '?([a-z-]+)'?: \[$([\s\S]*?)^  \],?$/gm)) {
    const banque = m[1];
    [...m[2].matchAll(/^    \[/gm)].forEach((_, i) => {
      attendues.push(`secours.${banque}.${i}.cat`);
      if (!banque.startsWith('langue')) attendues.push(`secours.${banque}.${i}.q`);
    });
  }
  assert.ok(attendues.length > 100, `trop peu d'entrées de secours : ${attendues.length}`);

  for (const langue of ['en', 'es']) {
    const dico = (await import(`../js/langues/${langue}.js`)).default;
    const manquantes = attendues.filter(c => !(c in dico));
    assert.deepEqual(manquantes.slice(0, 8), [],
      `${langue} : ${manquantes.length} question(s) de secours sans traduction`);

    // L'exception doit rester une exception : pas de traduction du texte
    // d'une épreuve de langue, sinon le candidat passe son TOEIC en anglais
    // mais lit ses questions en espagnol.
    const detournees = Object.keys(dico).filter(c => /^secours\.langue[a-z-]*\.\d+\.q$/.test(c));
    assert.deepEqual(detournees, [],
      `${langue} : une épreuve de langue se passe dans la langue de l'examen`);
  }
});

test('les textes juridiques traduits disent que le français fait foi', async () => {
  /* Traduire des CGV soumises au droit français sans le dire laisserait
     croire à deux versions également opposables. */
  const src = readFileSync(join(RACINE, 'js/legal.js'), 'utf8');
  const fonction = src.slice(src.indexOf('const avertissementTraduction'), src.indexOf('export const textes'));
  assert.match(fonction, /langue\(\)\s*===\s*'fr'\s*\?\s*''/,
    "l'avertissement ne doit s'afficher que hors français");
  assert.match(fonction, /legal\.version_fr_fait_foi/,
    "l'avertissement doit passer par une clé traduite");

  // Il doit être posé sur les quatre textes, pas seulement sur les CGV.
  const corps = src.slice(src.indexOf('export const textes'));
  const poses = [...corps.matchAll(/\$\{avertissementTraduction\(\)\}/g)].length;
  assert.equal(poses, 4, `avertissement posé sur ${poses} texte(s) au lieu de 4`);

  for (const langue of ['en', 'es']) {
    const dico = (await import(`../js/langues/${langue}.js`)).default;
    assert.ok(dico['legal.version_fr_fait_foi']?.trim(),
      `${langue} : l'avertissement de traduction n'est pas traduit`);
  }
});

test('le modèle reçoit la langue choisie, pour les questions comme pour la correction', async () => {
  /* Traduire l'interface sans traduire ce que le modèle écrit donnait
     une page anglaise dont les questions d'examinateur restaient en
     français — c'est-à-dire le produit lui-même. */
  const questionsApi = readFileSync(join(RACINE, 'api/questions.js'), 'utf8');
  assert.match(questionsApi, /langue\s*=\s*'fr'\s*\}\s*=\s*req\.body|langue = 'fr' \} = req\.body/s,
    '/api/questions doit lire la langue demandée');
  assert.match(questionsApi, /nomLangue\(langue\)/,
    'la consigne système doit nommer la langue de rédaction');

  const questionsJs = readFileSync(join(RACINE, 'js/questions.js'), 'utf8');
  const appel = questionsJs.slice(questionsJs.indexOf('export async function genererQuestions'),
                                 questionsJs.indexOf('/* ── Extraction de mots-clés'));
  assert.match(appel, /langue:\s*langue\(\)/,
    'le navigateur doit envoyer sa langue avec la demande de questions');

  const feedbackJs = readFileSync(join(RACINE, 'js/feedback.js'), 'utf8');
  const evaluer = feedbackJs.slice(feedbackJs.indexOf('export async function evaluer'),
                                   feedbackJs.indexOf("/* ═══ Analyse d'éloquence"));
  assert.match(evaluer, /langue:\s*langue\(\)/, 'la correction doit partir avec la langue');
  assert.match(evaluer, /criteres:\s*typeTraduit\(typeId\)\.criteres/,
    'les critères doivent partir traduits : ils reviennent comme libellés du rapport');
});

test("l'examinateur parle la langue choisie hors épreuve de langue", async () => {
  const src = readFileSync(join(RACINE, 'js/speech.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function langueDeLEpreuve'),
                       src.indexOf('/* ── 3. Bouton'));
  assert.ok(fn.length > 50, 'langueDeLEpreuve introuvable');
  assert.match(fn, /return infoLangue\(\)\.voix/,
    "hors certification, la voix doit suivre la langue d'interface");
  assert.ok(!/return 'fr-FR'/.test(fn),
    'le français ne doit plus être le repli figé de la voix');
});

test("la déclaration d'âge reprend le lancement au lieu de l'abandonner", async () => {
  /* Le candidat remplissait son dossier, cliquait sur « Lancer »,
     déclarait son âge — et il ne se passait plus rien. Il fallait
     cliquer une seconde fois, sans que rien ne le dise. Reproduit
     dans un navigateur. */
  const age = readFileSync(join(RACINE, 'js/age.js'), 'utf8');
  const demande = age.slice(age.indexOf('export function demanderAgeSiNecessaire'),
                            age.indexOf('export function demanderAgeSiNecessaire') + 400);
  assert.match(demande, /demanderAgeSiNecessaire\(\s*auRetour/,
    'la fonction doit accepter une action à reprendre');
  assert.match(demande, /reprise = auRetour/, "l'action doit être mémorisée");

  // Elle doit être rejouée à la validation, et seulement si l'usage est permis.
  const validation = age.slice(age.indexOf("valider?.addEventListener"));
  assert.match(validation, /if \(aReprendre && peutUtiliser\(\)\) aReprendre\(\)/,
    "l'action doit être rejouée, et refusée tant qu'un accord parental manque");
  assert.match(validation, /reprise = null/,
    "l'action ne doit pas pouvoir être rejouée deux fois");

  // Et le simulateur doit effectivement passer son lancement en reprise.
  const sim = readFileSync(join(RACINE, 'js/simulateur.js'), 'utf8');
  assert.match(sim, /demanderAgeSiNecessaire\(lancerSimulation\)/,
    'le simulateur doit se donner lui-même comme reprise');
  assert.match(sim, /\$\('#btn-lancer'\)\.addEventListener\('click', lancerSimulation\)/,
    'le bouton doit appeler la même fonction que la reprise');
});

test("une offre reste cliquable sans la déclaration d'âge, et dit pourquoi", () => {
  /* Les trois offres étaient désactivées tant que la case n'était pas
     cochée. Un bouton désactivé n'émet aucun clic : toucher une offre ne
     produisait rien, pas même le message d'explication — jamais atteint.
     Sur tablette, on touchait trois cartes grisées sans comprendre. */
  const src = modules.find(m => m.nom === 'paywall.js').source;
  const maj = src.slice(src.indexOf('function majEtatOffres('),
                        src.indexOf('\n}', src.indexOf('function majEtatOffres(')));
  assert.ok(!/\.disabled\s*=/.test(maj),
    "les offres ne doivent plus être désactivées : le clic doit pouvoir expliquer");

  // Le refus doit s'afficher contre la case, pas seulement en bas de l'écran.
  const signal = src.slice(src.indexOf('function signalerAgeManquant('),
                           src.indexOf('\n}', src.indexOf('function signalerAgeManquant(')));
  assert.match(signal, /rappel-confirmation-age/, 'le rappel doit avoir sa place dans la page');
  assert.match(signal, /scrollIntoView/, 'la case doit être ramenée sous les yeux');

  // Et la déclaration reste exigée avant tout paiement (art. 1145 code civil).
  const checkout = src.slice(src.indexOf('export async function lancerCheckout'));
  assert.match(checkout, /if \(!\$\('#confirmation-age'\)\?\.checked\) \{\s*\n\s*signalerAgeManquant\(\);\s*\n\s*return;/,
    'le paiement doit rester bloqué sans la déclaration');

  // Le balisage doit porter les deux crochets, sur chaque page qui vend.
  for (const { fichier } of PAGES) {
    const page = lire(fichier);
    assert.match(page, /id="bloc-confirmation-age"/, `${fichier} : bloc de la case absent`);
    assert.match(page, /id="rappel-confirmation-age"/, `${fichier} : rappel absent`);
  }
});

test("l'avertissement des mentions s'adresse à l'éditeur, pas aux visiteurs", () => {
  /* Il listait au bas de chaque page les mentions manquantes — nom,
     SIRET, TVA, adresse… — devant des candidats venus s'entraîner, qui
     n'y peuvent rien. Il part désormais dans la console, où l'éditeur
     le retrouve, et ne revient dans la page que s'il le demande.

     Il ne disparaît pas : les mentions restent obligatoires avant toute
     vente, et le message doit continuer de le dire. */
  const src = modules.find(m => m.nom === 'legal.js').source;
  const fn = src.slice(src.indexOf('export function verifierMentions'),
                       src.indexOf('\n}', src.indexOf('export function verifierMentions')));

  assert.match(fn, /console\.warn/, "l'éditeur doit continuer d'être averti");
  assert.match(fn, /L111-1/, "l'avertissement doit rappeler le fondement légal");
  assert.match(fn, /AFFICHER_ALERTE_MENTIONS/,
    "l'éditeur doit pouvoir réafficher le bandeau dans la page");
  assert.match(fn, /AFFICHER_ALERTE_MENTIONS[\s\S]{0,120}classList\.add\('hidden'\)/,
    'sans ce réglage, le bandeau doit rester caché aux visiteurs');
});
