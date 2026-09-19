/* ═══════════════════════════════════════════════════════════
   tests/avatar.test.mjs

   « L'espace de stockage des photos n'est pas encore créé sur ce
   site. Prévenez l'éditeur. » Le navigateur déposait la photo
   directement dans Supabase, et la clé publique n'a pas le droit
   de créer un compartiment : le site renvoyait donc le candidat
   vers quelqu'un d'autre pour un réglage qu'il ne pouvait pas
   faire lui-même.

   La route s'en charge, avec la clé « service role ». Elle a donc
   les pleins pouvoirs, et c'est précisément ce que ces tests
   surveillent : le dossier vient du jeton vérifié et jamais du
   corps de la requête, le format est borné, et l'effacement ne
   déborde pas sur le voisin.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assurerCompartiment, effacerAnciennes, traiter, TYPES, TAILLE_MAX }
  from '../api/avatar.js';

/** Un Supabase de papier : ce qui compte est l'enchaînement, pas le réseau. */
function faireSupabase({ compartimentExiste = false, echecCreation = null, echecDepot = null } = {}) {
  const etat = {
    compartiments: new Set(compartimentExiste ? ['avatars'] : []),
    fichiers: [], effaces: [], optionsCreation: null
  };
  const sb = {
    etat,
    storage: {
      getBucket: async nom => etat.compartiments.has(nom)
        ? { data: { name: nom }, error: null }
        : { data: null, error: { message: 'Bucket not found' } },
      createBucket: async (nom, options) => {
        etat.optionsCreation = options;
        if (echecCreation) return { error: { message: echecCreation } };
        etat.compartiments.add(nom);
        return { data: { name: nom }, error: null };
      },
      from: () => ({
        list: async dossier => ({
          data: etat.fichiers.filter(f => f.startsWith(dossier + '/'))
                              .map(f => ({ name: f.split('/').pop() })) }),
        remove: async chemins => {
          etat.effaces.push(...chemins);
          etat.fichiers = etat.fichiers.filter(f => !chemins.includes(f));
          return { error: null };
        },
        upload: async (chemin, octets, opts) => {
          if (echecDepot) return { error: { message: echecDepot } };
          etat.fichiers.push(chemin);
          etat.dernier = { chemin, taille: octets.length, type: opts?.contentType };
          return { error: null };
        },
        getPublicUrl: chemin => ({ data: {
          publicUrl: `https://exemple.supabase.co/storage/v1/object/public/avatars/${chemin}` } })
      })
    }
  };
  return sb;
}

const CANDIDAT = { id: '11111111-1111-1111-1111-111111111111' };
const VOISIN = '22222222-2222-2222-2222-222222222222';
// Un JPEG minuscule mais réel, pour ne pas tester sur du vide.
const IMAGE = Buffer.from([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0xFF, 0xD9]).toString('base64');

test('le compartiment est créé quand il manque', async () => {
  const sb = faireSupabase();
  assert.equal(await assurerCompartiment(sb), null);
  assert.ok(sb.etat.compartiments.has('avatars'),
    'le serveur doit créer le compartiment, pas le réclamer au candidat');
});

test('un compartiment déjà créé par un envoi simultané n’est pas une panne', async () => {
  const sb = faireSupabase({ echecCreation: 'The resource already exists' });
  assert.equal(await assurerCompartiment(sb), null,
    'deux envois en même temps ne doivent pas se gêner');
});

test('une vraie panne de création est signalée', async () => {
  const sb = faireSupabase({ echecCreation: 'Service indisponible' });
  assert.equal(await assurerCompartiment(sb), 'Service indisponible');
});

test('le compartiment est public, borné en taille, et refuse le SVG', async () => {
  const sb = faireSupabase();
  await assurerCompartiment(sb);
  const o = sb.etat.optionsCreation;

  assert.equal(o.public, true, 'la photo doit être lisible par la page');
  assert.ok(o.fileSizeLimit <= TAILLE_MAX, 'la limite de taille doit être posée');
  assert.ok(!o.allowedMimeTypes.some(t => /svg/i.test(t)),
    'un SVG est un document qui peut porter du script : il reste dehors');
});

test('seuls trois formats d’image sont acceptés', () => {
  assert.deepEqual(Object.keys(TYPES).sort(), ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(TYPES['image/svg+xml'], undefined, 'le SVG doit rester refusé');
});

test('les photos précédentes partent : une seule par compte, et pas chez le voisin', async () => {
  const sb = faireSupabase({ compartimentExiste: true });
  sb.etat.fichiers = [
    `${CANDIDAT.id}/photo-1.jpg`, `${CANDIDAT.id}/photo-2.jpg`, `${VOISIN}/photo-9.jpg`
  ];
  await effacerAnciennes(sb, CANDIDAT.id);

  assert.deepEqual(sb.etat.effaces.sort(),
    [`${CANDIDAT.id}/photo-1.jpg`, `${CANDIDAT.id}/photo-2.jpg`]);
  assert.ok(sb.etat.fichiers.includes(`${VOISIN}/photo-9.jpg`),
    "l'effacement ne doit jamais déborder sur un autre compte");
});

test('un envoi complet rend une adresse publique', async () => {
  const sb = faireSupabase();
  const { code, corps } = await traiter(sb, CANDIDAT, { contenu: IMAGE, type: 'image/jpeg' });

  assert.equal(code, 200);
  assert.match(corps.url, /\/storage\/v1\/object\/public\/avatars\//,
    "l'adresse doit être celle que le site reconnaît comme une photo déposée");
  assert.ok(corps.url.includes(CANDIDAT.id), 'la photo appartient au dossier du candidat');
  assert.equal(sb.etat.dernier.type, 'image/jpeg');
});

test('le dossier vient du jeton, jamais du corps de la requête', async () => {
  const sb = faireSupabase();
  /* La clé de service ignore les règles RLS : si le chemin venait du
     navigateur, n'importe qui écraserait la photo de n'importe qui. */
  const { corps } = await traiter(sb, CANDIDAT, {
    contenu: IMAGE, type: 'image/jpeg',
    id: VOISIN, dossier: VOISIN, chemin: `${VOISIN}/photo.jpg`, userId: VOISIN
  });

  assert.ok(corps.url.includes(CANDIDAT.id), 'le dossier doit rester celui du jeton');
  assert.ok(!corps.url.includes(VOISIN), "le corps de la requête ne doit pas choisir le dossier");
});

test('un format refusé ne touche pas au stockage', async () => {
  const sb = faireSupabase();
  const { code, corps } = await traiter(sb, CANDIDAT,
    { contenu: IMAGE, type: 'image/svg+xml' });

  assert.equal(code, 400);
  assert.match(corps.erreur, /JPEG/);
  assert.equal(sb.etat.fichiers.length, 0, 'rien ne doit être déposé');
});

test('un base64 qui ne contient aucune donnée est refusé', async () => {
  const sb = faireSupabase();
  /* Buffer.from ignore en silence ce qu'il ne sait pas décoder : sans
     ce garde-fou, un fichier vide partirait sans un mot. */
  const { code, corps } = await traiter(sb, CANDIDAT, { contenu: '!!!!', type: 'image/jpeg' });

  assert.equal(code, 400);
  assert.match(corps.erreur, /illisible/i);
  assert.equal(sb.etat.fichiers.length, 0);
});

test('une photo trop lourde est refusée avant le dépôt', async () => {
  const sb = faireSupabase();
  const gros = Buffer.alloc(TAILLE_MAX + 1, 0x41).toString('base64');
  const { code, corps } = await traiter(sb, CANDIDAT, { contenu: gros, type: 'image/jpeg' });

  assert.equal(code, 413);
  assert.match(corps.erreur, /2 Mo/);
  assert.equal(sb.etat.fichiers.length, 0);
});

test('la suppression efface le fichier, pas seulement l’affichage', async () => {
  const sb = faireSupabase({ compartimentExiste: true });
  sb.etat.fichiers = [`${CANDIDAT.id}/photo-1.jpg`];
  const { code, corps } = await traiter(sb, CANDIDAT, { supprimer: true });

  assert.equal(code, 200);
  assert.equal(corps.url, '');
  assert.deepEqual(sb.etat.effaces, [`${CANDIDAT.id}/photo-1.jpg`],
    'retirer sa photo doit la retirer du serveur, pas seulement de la page');
});

test('un dépôt en échec ne rend pas une fausse adresse', async () => {
  const sb = faireSupabase({ echecDepot: 'Stockage saturé' });
  const { code, corps } = await traiter(sb, CANDIDAT, { contenu: IMAGE, type: 'image/jpeg' });

  assert.equal(code, 500);
  assert.equal(corps.url, undefined);
  assert.match(corps.erreur, /saturé/);
});
