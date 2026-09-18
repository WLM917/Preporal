/* ═══════════════════════════════════════════════════════════
   tests/csp.test.mjs

   Vérifie que la politique de sécurité de contenu autorise
   réellement tous les hôtes que le front sollicite.

   Ce test existe parce qu'une CSP trop stricte avait cassé
   l'import de PDF, de DOCX et la lecture optique : les scripts
   étaient chargés depuis un CDN absent de script-src. Rien ne le
   signalait au build — la page se chargeait, seul l'import
   échouait silencieusement.

   pdf.js et mammoth sont depuis servis par le site (assets/vendor).
   Seule la lecture optique reste distante.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

const csp = JSON.parse(readFileSync(join(RACINE, 'vercel.json'), 'utf8'))
  .headers.find(r => r.source === '/(.*)')
  .headers.find(h => h.key === 'Content-Security-Policy').value;

/** { 'script-src': ['self', 'https://esm.sh', …], … } */
const directives = Object.fromEntries(
  csp.split(';').map(s => s.trim()).filter(Boolean).map(d => {
    const [nom, ...sources] = d.split(/\s+/);
    return [nom, sources];
  })
);

const autorise = (directive, hote) => {
  const sources = directives[directive] || directives['default-src'] || [];
  return sources.some(s => s === hote || s === `${hote}/` ||
    (s.startsWith('https://*.') && hote.endsWith(s.slice('https://*.'.length))));
};

/* Hôtes réellement référencés dans le code du front. */
function hotesReferences() {
  // js/ contient désormais un sous-dossier langues/ : on ne lit que les fichiers.
  const modules = readdirSync(join(RACINE, 'js'), { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => join(RACINE, 'js', e.name));
  const traductions = readdirSync(join(RACINE, 'js', 'langues'), { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.js'))
    .map(e => join(RACINE, 'js', 'langues', e.name));
  const fichiers = [join(RACINE, 'index.html'), join(RACINE, 'simulateur.html'),
    join(RACINE, 'temoignages.html'), join(RACINE, 'compte.html'), ...modules, ...traductions];
  const hotes = new Set();
  for (const f of fichiers) {
    for (const m of readFileSync(f, 'utf8').matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)) {
      hotes.add('https://' + m[1]);
    }
  }
  return [...hotes];
}

test('la CSP déclare les directives essentielles', () => {
  for (const d of ['default-src', 'script-src', 'connect-src', 'style-src',
                   'font-src', 'img-src', 'frame-ancestors', 'object-src', 'base-uri']) {
    assert.ok(directives[d], `directive ${d} absente de la CSP`);
  }
});

test('le site ne peut pas être encadré ni injecter d\'objet', () => {
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
});

test("aucune directive n'ouvre la porte en grand", () => {
  for (const [nom, sources] of Object.entries(directives)) {
    assert.ok(!sources.includes('*'), `${nom} autorise toutes les origines`);
    assert.ok(!sources.includes("'unsafe-eval'"),
      `${nom} autorise 'unsafe-eval' — le CDN Tailwind l'exigeait, il a été retiré`);
  }
});

test('chaque hôte externe utilisé par le front est autorisé quelque part', () => {
  const connus = {
    'https://fonts.googleapis.com': 'style-src',
    'https://fonts.gstatic.com': 'font-src',
    'https://esm.sh': 'script-src',
    'https://cdn.jsdelivr.net': 'script-src'
  };
  for (const hote of hotesReferences()) {
    const directive = connus[hote];
    if (!directive) continue;               // supabase : couvert par le joker ci-dessous
    assert.ok(autorise(directive, hote),
      `${hote} est chargé par le front mais absent de ${directive}`);
  }
});

test('les bibliothèques d\'extraction de documents peuvent être chargées', () => {
  // Seule la lecture optique vient encore d'un CDN.
  for (const hote of ['https://cdn.jsdelivr.net']) {
    assert.ok(autorise('script-src', hote), `${hote} absent de script-src`);
    assert.ok(autorise('connect-src', hote), `${hote} absent de connect-src`);
    assert.ok(autorise('worker-src', hote), `${hote} absent de worker-src`);
  }
  // pdf.js et mammoth sont servis par le site : 'self' suffit, et le
  // worker de pdf.js est désormais de même origine.
  for (const d of ['script-src', 'worker-src']) {
    assert.ok((directives[d] || []).includes("'self'"), `${d} doit autoriser 'self'`);
  }
  // La lecture optique télécharge ses données de langue à l'exécution.
  assert.ok(autorise('connect-src', 'https://tessdata.projectnaptha.com'),
    'les données de langue de la lecture optique seraient bloquées');
  // pdf.js et tesseract instancient leurs travailleurs depuis un blob.
  assert.ok((directives['worker-src'] || []).includes('blob:'),
    'worker-src doit accepter blob:');
});

test('Supabase est joignable en HTTP et en WebSocket', () => {
  assert.ok(autorise('connect-src', 'https://xyz.supabase.co'));
  assert.ok((directives['connect-src'] || []).some(s => s.startsWith('wss://')),
    'connect-src doit autoriser wss:// pour le temps réel Supabase');
});

test('la redirection vers Stripe reste possible', () => {
  const fa = directives['form-action'] || [];
  assert.ok(fa.some(s => s.includes('checkout.stripe.com')));
  assert.ok(fa.some(s => s.includes('billing.stripe.com')));
});

test("seul ce qui ne change jamais est mis en cache pour un an", () => {
  /* assets/ tout entier était servi « immutable, max-age=31536000 ».
     Or la feuille de style y vit, elle est régénérée à chaque
     modification, et son nom ne porte aucune empreinte : un visiteur
     déjà venu gardait l'ancienne mise en page jusqu'à un an, sans
     aucun moyen de s'en douter — ni d'y remédier autrement qu'en
     vidant les données du site. */
  const vercel = JSON.parse(readFileSync(join(RACINE, 'vercel.json'), 'utf8'));
  const cache = source => vercel.headers
    .find(h => h.source === source)?.headers
    .find(x => x.key === 'Cache-Control')?.value;

  assert.match(cache('/assets/vendor/(.*)') || '', /immutable/,
    'les bibliothèques livrées avec le site ne changent jamais de contenu');

  /* La règle générale des assets : celle qui vise assets/ sans viser
     assets/vendor. Son motif exact est vérifié plus bas. */
  const generale = vercel.headers.find(h => /^\/assets\//.test(h.source) && !h.source.includes('vendor/('));
  assert.ok(generale, 'règle générale des assets introuvable');

  for (const source of [generale.source, '/js/(.*)']) {
    const valeur = cache(source);
    assert.ok(valeur, `${source} : aucune règle de cache`);
    assert.match(valeur, /must-revalidate/, `${source} doit être revalidé`);
    assert.ok(!/immutable/.test(valeur),
      `${source} change avec le site : le figer force le visiteur à vider son cache`);
  }

  /* La règle des bibliothèques doit gagner, quelle que soit la sémantique.

     Deux tentatives ont échoué sur le site déployé, chacune fondée sur
     une hypothèse invérifiable : d'abord la règle spécifique placée en
     premier (« la première qui correspond gagne »), puis l'exclusion du
     dossier dans la règle générale. Dans les deux cas,
     assets/vendor/pdf.min.js recevait encore la règle générale.

     La documentation de Vercel ne dit pas laquelle des règles
     concordantes l'emporte. On satisfait donc les deux lectures à la
     fois : la règle générale exclut le dossier ET la règle des
     bibliothèques est placée en dernier. C'est redondant à dessein —
     la redondance coûte une ligne, se tromper coûte un déploiement. */
  assert.match(generale.source, /\(\?!vendor\//,
    'la règle générale doit exclure assets/vendor : « la première qui correspond gagne »');

  const rang = s => vercel.headers.findIndex(h => h.source === s);
  const dernier = vercel.headers.length - 1;
  assert.equal(rang('/assets/vendor/(.*)'), dernier,
    'la règle des bibliothèques doit être la dernière : « la dernière qui correspond gagne »');
});
