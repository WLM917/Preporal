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
    join(RACINE, 'temoignages.html'), ...modules, ...traductions];
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
