/* ═══════════════════════════════════════════════════════════
   GET /api/veille — garder la base éveillée

   Sur son plan gratuit, Supabase met un projet en pause après une
   semaine de faible activité. C'est arrivé : l'adresse du projet a
   disparu du DNS, et plus personne ne pouvait se connecter, lancer
   une simulation ni relire son historique.

   Vercel appelle cette route une fois par jour (« crons », dans
   vercel.json). Elle fait une lecture minuscule dans la base : selon
   la documentation de Supabase, quelques requêtes par jour suffisent
   à garder un projet actif. Elle ne renvoie rien de ce qu'elle lit,
   seulement si la base a répondu.

   Le plan Pro de Supabase rend cette route inutile : un projet payant
   n'est jamais mis en pause.
   ═══════════════════════════════════════════════════════════ */

import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { limiter } from './_lib/ia.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ erreur: 'Méthode non autorisée.' });

  /* Vercel envoie « Authorization: Bearer <CRON_SECRET> » quand ce
     secret est défini : on l'exige alors. Sans lui, la route reste
     ouverte — bornée en débit, elle ne fait qu'une lecture et ne rend
     rien — plutôt que de refuser l'appel de Vercel, et de laisser la
     base se rendormir parce qu'un réglage manque. */
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ erreur: 'Non autorisé.' });
    }
  } else if (!await limiter(req, res, { max: 6, prefixe: 'veille' })) {
    return;
  }

  // Une réponse mise en cache ne réveillerait rien : la fonction ne tournerait pas.
  res.setHeader('Cache-Control', 'no-store');

  const sb = supabaseAdmin();
  if (!sb) return res.status(503).json({ ok: false, erreur: 'Base non configurée.' });

  const { error } = await sb.from('profils').select('id').limit(1);
  if (error) {
    /* Vercel ne relance jamais une tâche planifiée qui échoue : l'échec
       doit au moins se lire dans les journaux de la tâche. */
    console.error('Veille de la base : pas de réponse', error.message || error);
    return res.status(503).json({ ok: false, erreur: 'La base ne répond pas.' });
  }
  return res.status(200).json({ ok: true });
}
