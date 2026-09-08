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
export async function majProfil(utilisateurId, champs) {
  const sb = supabaseAdmin();
  if (!sb || !utilisateurId) return;
  await sb.from('profils').upsert({ id: utilisateurId, ...champs, maj_le: new Date().toISOString() });
}

/** Retrouve un profil par identifiant client Stripe. */
export async function profilParClientStripe(stripeClientId) {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data } = await sb.from('profils').select('id').eq('stripe_client_id', stripeClientId).maybeSingle();
  return data || null;
}
