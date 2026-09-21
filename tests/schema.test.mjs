/* ═══════════════════════════════════════════════════════════
   tests/schema.test.mjs

   Le schéma SQL n'a pas de tests d'exécution : il tourne dans
   Postgres, pas ici. Mais deux de ses propriétés se lisent dans
   le fichier, et toutes deux ont déjà coûté cher.

   • Une règle RLS choisit quelles LIGNES on peut modifier, jamais
     quelles COLONNES. Sans grant par colonne, un compte connecté
     s'offre un abonnement depuis la console de son navigateur.

   • Le monogramme que Google fabrique pour les comptes sans photo
     ne doit pas entrer dans avatar_url. C'est de là que venait le
     grand W, corrigé quatre fois côté affichage sans que la cause
     soit touchée.
   ═══════════════════════════════════════════════════════════ */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lire = f => readFileSync(join(RACINE, 'supabase', f), 'utf8');
const FICHIERS = ['schema.sql', 'correctif-profils.sql'];

/** Les colonnes qu'un candidat ne doit jamais pouvoir écrire lui-même. */
const PAYANTES = ['premium', 'plan', 'premium_jusqu_au', 'stripe_client_id'];

for (const fichier of FICHIERS) {
  test(`${fichier} : un candidat ne peut pas s'offrir un abonnement`, () => {
    const sql = lire(fichier);

    assert.match(sql, /revoke update on public\.profils from authenticated/,
      "sans révocation, l'écriture reste ouverte sur toutes les colonnes");

    const grant = sql.match(/grant\s+update\s*\(([^)]*)\)\s*\n?\s*on public\.profils/i);
    assert.ok(grant, 'les colonnes modifiables doivent être énumérées');

    const accordees = grant[1].split(',').map(c => c.trim());
    for (const colonne of PAYANTES) {
      assert.ok(!accordees.includes(colonne),
        `« ${colonne} » ne doit jamais être écrite depuis le navigateur : ` +
        'seules les fonctions serveur la touchent, après vérification de Stripe');
    }
    assert.ok(accordees.includes('avatar_url') && accordees.includes('pseudo'),
      'les réglages d\'affichage doivent, eux, rester modifiables');
  });

  test(`${fichier} : le monogramme de Google n'entre pas dans avatar_url`, () => {
    const sql = lire(fichier);
    const debut = sql.indexOf('function public.creer_profil');
    if (debut === -1) return;                      // ce fichier ne définit pas le déclencheur

    const fonction = sql.slice(debut, sql.indexOf('$$;', debut));
    assert.ok(!/'picture'/.test(fonction),
      "« picture » est l'image que Google fabrique quand le compte n'en a pas : " +
      "la reprendre fait revenir le grand W à chaque ouverture de session");
    assert.match(fonction, /raw_user_meta_data->>'avatar_url'/,
      'la photo réellement déposée doit, elle, être reprise');
  });
}

test('chacun peut créer sa propre ligne, et seulement la sienne', () => {
  /* Il y avait une règle de lecture et une de modification, aucune
     d'insertion. Or modifier une ligne absente ne touche rien et ne
     lève aucune erreur : le site écrivait dans le vide. */
  for (const fichier of FICHIERS) {
    const sql = lire(fichier);
    const regle = sql.match(/create policy "profil cree par son proprietaire"[\s\S]{0,200}/);
    assert.ok(regle, `${fichier} : la règle d'insertion manque`);
    assert.match(regle[0], /for insert with check \(auth\.uid\(\) = id\)/,
      `${fichier} : chacun ne doit pouvoir créer que sa propre ligne`);
  }
});

test('le correctif rattrape les comptes antérieurs au déclencheur', () => {
  const sql = lire('correctif-profils.sql');
  assert.match(sql, /from auth\.users u/,
    'les comptes ouverts avant la création du déclencheur n\'ont jamais eu de ligne');
  assert.match(sql, /on conflict \(id\) do nothing/,
    'le rattrapage doit pouvoir être rejoué sans écraser ce qui existe');
});

test("l'historique du compte porte le détail des simulations", () => {
  /* Sans ces colonnes, une simulation ouverte depuis un autre appareil
     ne montre qu'une note : le détail ne serait jamais remonté. */
  const COLONNES = ['reponses', 'eloquence_detail', 'verdict', 'temps_total', 'details'];

  for (const fichier of ['schema.sql', 'correctif-simulations.sql']) {
    const sql = lire(fichier);
    for (const colonne of COLONNES) {
      assert.match(sql, new RegExp(`add column if not exists\\s+${colonne}\\b`),
        `${fichier} : la colonne ${colonne} manque`);
    }
  }
});

test('chacun ne lit et n’efface que ses propres simulations', () => {
  /* Ces lignes portent maintenant des réponses personnelles : une règle
     trop large les exposerait à tous les comptes. */
  for (const fichier of ['schema.sql', 'correctif-simulations.sql']) {
    const sql = lire(fichier);
    for (const action of ['select', 'delete']) {
      const regle = sql.match(new RegExp(`for ${action} using \\(auth\\.uid\\(\\) = utilisateur_id\\)`));
      assert.ok(regle, `${fichier} : la règle « ${action} » doit être restreinte à l'auteur`);
    }
    assert.match(sql, /for insert with check \(auth\.uid\(\) = utilisateur_id\)/,
      `${fichier} : personne ne doit pouvoir écrire une simulation au nom d'un autre`);
  }
});

test('compléter une simulation ne permet pas de réécrire sa note', () => {
  /* Le rattrapage a besoin d'écrire sur une ligne existante. Une règle
     RLS choisit quelles LIGNES on peut modifier, jamais quelles
     COLONNES : sans restriction, un compte réécrirait sa propre note ou
     déplacerait une simulation chez quelqu'un d'autre. */
  const INTOUCHABLES = ['score', 'eloquence', 'utilisateur_id', 'cree_le', 'criteres'];

  for (const fichier of ['schema.sql', 'correctif-rattrapage.sql']) {
    const sql = lire(fichier);

    assert.match(sql, /for update\s*\n?\s*using\s*\(auth\.uid\(\) = utilisateur_id\)/,
      `${fichier} : on ne complète que ses propres simulations`);
    assert.match(sql, /with check\s*\(auth\.uid\(\) = utilisateur_id\)/,
      `${fichier} : et on ne peut pas en donner une à quelqu'un d'autre`);
    assert.match(sql, /revoke update on public\.simulations from authenticated/,
      `${fichier} : sans révocation, toutes les colonnes restent ouvertes`);

    const grant = sql.match(/grant\s+update\s*\(([^)]*)\)\s*\n?\s*on public\.simulations/i);
    assert.ok(grant, `${fichier} : les colonnes modifiables doivent être énumérées`);

    const accordees = grant[1].split(',').map(c => c.trim());
    for (const colonne of INTOUCHABLES) {
      assert.ok(!accordees.includes(colonne),
        `${fichier} : « ${colonne} » ne doit pas être réécrivable depuis le navigateur`);
    }
    assert.ok(accordees.includes('reponses') && accordees.includes('verdict'),
      `${fichier} : le détail doit, lui, pouvoir être complété`);
  }
});
