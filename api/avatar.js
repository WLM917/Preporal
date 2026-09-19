/* ═══════════════════════════════════════════════════════════
   POST /api/avatar
   Entrée : { contenu: "<base64>", type: "image/jpeg" }
            ou { supprimer: true }
   Sortie : { url }  →  l'adresse publique de la photo, ou ''

   Pourquoi passer par le serveur plutôt que déposer la photo
   directement depuis le navigateur :

   • Le compartiment « avatars » doit exister. Le navigateur ne
     peut pas le créer — la clé publique n'en a pas le droit — et
     le site se contentait donc d'annoncer « l'espace de stockage
     des photos n'est pas encore créé, prévenez l'éditeur ». Ici,
     la clé « service role » le crée au premier envoi, une fois
     pour toutes, et plus personne n'a à ouvrir Supabase.

   • Déposer depuis le navigateur demande en plus d'écrire à la
     main les règles RLS de storage.objects. La clé de service
     s'en passe : une règle de moins à oublier, et un chemin de
     moins par où se tromper.

   Ce que le serveur vérifie, puisqu'il agit avec les pleins
   pouvoirs : le jeton du candidat, le type d'image, la taille,
   et le fait que le fichier atterrisse bien sous son propre
   identifiant.
   ═══════════════════════════════════════════════════════════ */

import { supabaseAdmin, utilisateurDepuisJeton } from './_lib/supabaseAdmin.js';
import { verifierMethode, limiter } from './_lib/ia.js';

export const COMPARTIMENT = 'avatars';
export const TAILLE_MAX = 2 * 1024 * 1024;          // 2 Mo, comme le compartiment

/* Trois formats, et pas un de plus. Le SVG est écarté exprès : c'est
   un document qui peut porter du script, et il serait servi depuis
   notre domaine de stockage. */
export const TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

/** Crée le compartiment s'il manque. Renvoie null si tout va bien. */
export async function assurerCompartiment(sb) {
  const { data, error } = await sb.storage.getBucket(COMPARTIMENT);
  if (data && !error) return null;

  const { error: creation } = await sb.storage.createBucket(COMPARTIMENT, {
    public: true,
    fileSizeLimit: TAILLE_MAX,
    allowedMimeTypes: Object.keys(TYPES)
  });

  /* Deux envois simultanés le créent en même temps : le second reçoit
     « already exists », ce qui est le résultat voulu, pas une panne. */
  if (creation && !/already exists|duplicate/i.test(creation.message || '')) {
    return creation.message || 'Compartiment de photos indisponible.';
  }
  return null;
}

/** Efface les photos précédentes : une seule par compte, pas d'archive. */
export async function effacerAnciennes(sb, dossier) {
  const { data } = await sb.storage.from(COMPARTIMENT).list(dossier);
  const chemins = (data || []).map(f => `${dossier}/${f.name}`);
  if (chemins.length) await sb.storage.from(COMPARTIMENT).remove(chemins);
}

/**
 * Le cœur de la route, séparé du transport.
 *
 * Il reçoit un client Supabase et un utilisateur DÉJÀ vérifié : le
 * dossier de destination vient de là, et jamais du corps de la
 * requête. C'est la seule chose qui empêche un compte d'écrire chez un
 * autre, puisque la clé de service ignore les règles RLS.
 *
 * @returns {Promise<{code: number, corps: object}>}
 */
export async function traiter(sb, utilisateur, corps = {}) {
  const { contenu, type, supprimer } = corps;
  const dossier = utilisateur.id;

  if (supprimer) {
    await effacerAnciennes(sb, dossier);
    return { code: 200, corps: { url: '' } };
  }

  const extension = TYPES[type];
  if (!extension) return { code: 400, corps: { erreur: 'Format accepté : JPEG, PNG ou WebP.' } };
  if (typeof contenu !== 'string' || !contenu) {
    return { code: 400, corps: { erreur: 'Photo manquante.' } };
  }

  const octets = Buffer.from(contenu, 'base64');
  /* Buffer.from ne se plaint pas d'un base64 invalide : il ignore ce
     qu'il ne comprend pas. Une chaîne de ponctuation donnerait donc un
     fichier vide, déposé sans un mot. */
  if (!octets.length) return { code: 400, corps: { erreur: 'Photo illisible.' } };
  if (octets.length > TAILLE_MAX) {
    return { code: 413, corps: { erreur: 'Photo trop lourde : 2 Mo maximum.' } };
  }

  const probleme = await assurerCompartiment(sb);
  if (probleme) return { code: 500, corps: { erreur: probleme } };

  // Le nom change à chaque envoi pour déjouer les caches.
  await effacerAnciennes(sb, dossier);
  const chemin = `${dossier}/photo-${Date.now()}.${extension}`;

  const { error } = await sb.storage.from(COMPARTIMENT)
    .upload(chemin, octets, { contentType: type, upsert: true });
  if (error) return { code: 500, corps: { erreur: error.message || "L'envoi de la photo a échoué." } };

  const { data } = sb.storage.from(COMPARTIMENT).getPublicUrl(chemin);
  if (!data?.publicUrl) return { code: 500, corps: { erreur: 'Adresse de la photo introuvable.' } };

  return { code: 200, corps: { url: data.publicUrl } };
}

export default async function handler(req, res) {
  if (!verifierMethode(req, res)) return;
  if (!await limiter(req, res, { max: 20, prefixe: 'avatar' })) return;

  const sb = supabaseAdmin();
  if (!sb) {
    /* Le nom de la variable manquante regarde l'éditeur, pas le
       candidat : il part dans les journaux du serveur, et la page se
       contente d'une phrase qu'on peut lire sans être développeur. */
    const manquantes = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(v => !process.env[v]);
    console.error('api/avatar : stockage non configuré, il manque ' + manquantes.join(' et '));
    return res.status(503).json({
      erreur: "L'envoi de photos n'est pas encore activé sur ce site. Réessayez plus tard."
    });
  }

  const utilisateur = await utilisateurDepuisJeton(req);
  if (!utilisateur?.id) {
    return res.status(401).json({ erreur: 'Connectez-vous pour changer votre photo.' });
  }

  try {
    const { code, corps } = await traiter(sb, utilisateur, req.body || {});
    return res.status(code).json(corps);
  } catch (e) {
    console.error('api/avatar', e);
    return res.status(500).json({ erreur: e?.message || "L'envoi de la photo a échoué." });
  }
}
