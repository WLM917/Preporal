/* ═══════════════════════════════════════════════════════════
   api/_lib/supabaseAdmin.js
   Client Supabase avec la clé « service role » : il contourne
   les règles RLS. À n'utiliser QUE dans les fonctions
   serverless, jamais dans le navigateur.
   ═══════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

let client = null;

export function supabaseAdmin() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) return null;          // mode « sans base » : le service fonctionne quand même
  client = createClient(url, cle, { auth: { persistSession: false } });
  return client;
}

/** Retrouve l'utilisateur à partir du jeton envoyé par le navigateur. */
export async function utilisateurDepuisJeton(req) {
  const entete = req.headers.authorization || '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : null;
  const sb = supabaseAdmin();
  if (!jeton || !sb) return null;
  try {
    const { data, error } = await sb.auth.getUser(jeton);
    if (error) return null;
    return data.user || null;
  } catch { return null; }
}

/** Écrit le statut Premium dans la table profils. */
/* Une écriture refusée doit LEVER une erreur, pas passer inaperçue.

   Le client Supabase ne lève rien quand la base est injoignable : il
   rend un objet { error } — et ce résultat était ignoré. Le webhook
   répondait donc « reçu » à Stripe, qui ne réessayait jamais, et un
   client débité pendant une panne de la base ne recevait jamais son
   Premium, sans que personne le sache. C'est arrivé : le projet
   Supabase a été mis en pause pour inactivité.

   En levant, le webhook répond 500, et Stripe renvoie l'évènement de
   lui-même pendant trois jours : le Premium arrive dès que la base
   revient. */
export async function majProfil(utilisateurId, champs) {
  const sb = supabaseAdmin();
  if (!sb || !utilisateurId) return;
  const { error } = await sb.from('profils')
    .upsert({ id: utilisateurId, ...champs, maj_le: new Date().toISOString() });
  if (error) throw new Error(`Profil non mis à jour (${utilisateurId}) : ${error.message || error}`);
}

/** Retrouve un profil par identifiant client Stripe. */
/* « Aucun profil » et « impossible de demander » ne sont pas la même
   réponse : confondre les deux faisait abandonner l'évènement, au lieu
   de le laisser revenir quand la base répondrait de nouveau. */
export async function profilParClientStripe(stripeClientId) {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb.from('profils').select('id').eq('stripe_client_id', stripeClientId).maybeSingle();
  if (error) throw new Error(`Profil introuvable faute de base (${stripeClientId}) : ${error.message || error}`);
  return data || null;
}
