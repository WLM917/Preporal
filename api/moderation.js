/* ═══════════════════════════════════════════════════════════
   /api/moderation — modération des avis

   GET  ?etat=attente|publies   liste les avis
   POST { id, action }          action : 'publier' | 'rejeter'

   Les avis arrivent avec publie = false : sans cette route, ils
   ne pouvaient jamais être publiés et la section témoignages
   restait vide indéfiniment.

   Accès réservé au porteur du jeton CLE_MODERATION. Ce n'est pas
   un système de comptes administrateurs : c'est le minimum pour
   qu'une personne seule puisse modérer sans ouvrir la base.

   Rappel légal : ne publiez que des avis authentiques. Publier
   un avis inventé, ou trier pour ne garder que les élogieux sans
   le dire, est une pratique commerciale trompeuse (art. L121-2
   et L111-7-2 du code de la consommation).
   ═══════════════════════════════════════════════════════════ */

import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { limiter } from './_lib/ia.js';

/** Comparaison à durée constante : évite de révéler le jeton octet par octet. */
function jetonValide(fourni) {
  const attendu = process.env.CLE_MODERATION;
  if (!attendu || !fourni) return false;
  const a = Buffer.from(String(fourni));
  const b = Buffer.from(attendu);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!await limiter(req, res, { max: 30, prefixe: 'moderation' })) return;

  const entete = req.headers.authorization || '';
  const fourni = entete.startsWith('Bearer ') ? entete.slice(7) : req.headers['x-cle-moderation'];

  if (!process.env.CLE_MODERATION) {
    return res.status(503).json({ erreur: "Modération non configurée : définissez CLE_MODERATION." });
  }
  if (!jetonValide(fourni)) {
    return res.status(401).json({ erreur: 'Jeton de modération invalide.' });
  }

  const sb = supabaseAdmin();
  if (!sb) return res.status(503).json({ erreur: 'Base de données non configurée.' });

  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const publies = (req.query?.etat || 'attente') === 'publies';
      const { data, error } = await sb
        .from('avis')
        .select('id, nom, statut, note, texte, type_oral, publie, cree_le')
        .eq('publie', publies)
        .order('cree_le', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return res.status(200).json({ avis: data || [] });
    }

    if (req.method === 'POST') {
      const { id, action } = req.body || {};
      if (!id || !['publier', 'rejeter'].includes(action)) {
        return res.status(400).json({ erreur: 'Paramètres invalides.' });
      }

      if (action === 'rejeter') {
        // Suppression franche : garder un avis rejeté n'a pas d'utilité et
        // conserve des données personnelles sans motif (minimisation RGPD).
        const { error } = await sb.from('avis').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return res.status(200).json({ ok: true, action: 'rejete' });
      }

      const { error } = await sb.from('avis').update({ publie: true }).eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, action: 'publie' });
    }

    return res.status(405).json({ erreur: 'Méthode non autorisée.' });

  } catch (e) {
    console.error('api/moderation', e?.message || e);
    return res.status(500).json({ erreur: 'Erreur serveur.' });
  }
}
