-- ═══════════════════════════════════════════════════════════
--  correctif-profils.sql
--  À coller dans Supabase → SQL Editor, puis Run.
--  Rejouable autant de fois qu'on veut, sans rien casser.
--
--  Quatre corrections, de la plus grave à la plus discrète.
-- ═══════════════════════════════════════════════════════════

-- ── 1. Un compte connecté pouvait s'offrir un abonnement ───
--
-- La règle RLS « profil modifiable par son proprietaire » choisit
-- QUELLES LIGNES on peut modifier. Elle ne dit rien des COLONNES, et
-- Supabase accorde par défaut l'écriture sur toutes. N'importe qui,
-- connecté, pouvait donc écrire « premium = true » sur sa propre ligne
-- depuis la console de son navigateur, avec la clé publique.
--
-- On borne les colonnes. premium, plan, premium_jusqu_au et
-- stripe_client_id passent hors d'atteinte : seules les fonctions
-- serveur les écrivent, avec la clé de service, après avoir vérifié la
-- signature de Stripe.

revoke update on public.profils from authenticated, anon;
grant  update (prenom, nom, pseudo, couleur, avatar_url, langue, maj_le)
  on public.profils to authenticated;

revoke insert on public.profils from authenticated, anon;
grant  insert (id, prenom, nom, pseudo, couleur, avatar_url, langue)
  on public.profils to authenticated;

-- ── 2. Personne ne pouvait créer sa propre ligne ───────────
--
-- Il y avait une règle de lecture et une règle de modification, aucune
-- d'insertion. Modifier une ligne absente ne touche rien et ne lève
-- aucune erreur : le site écrivait dans le vide, en silence.

drop policy if exists "profil cree par son proprietaire" on public.profils;
create policy "profil cree par son proprietaire"
  on public.profils for insert with check (auth.uid() = id);

-- ── 3. Les comptes antérieurs retrouvent leur ligne ────────
--
-- Le déclencheur ne s'applique qu'aux inscriptions postérieures à sa
-- création. Les comptes ouverts avant n'ont jamais eu de profil.

insert into public.profils (id, email, prenom, nom, pseudo, couleur, avatar_url, langue)
select u.id,
       u.email,
       coalesce(nullif(u.raw_user_meta_data->>'prenom', ''),
                nullif(u.raw_user_meta_data->>'given_name', '')),
       coalesce(nullif(u.raw_user_meta_data->>'nom', ''),
                nullif(u.raw_user_meta_data->>'family_name', '')),
       nullif(u.raw_user_meta_data->>'pseudo', ''),
       nullif(u.raw_user_meta_data->>'couleur', ''),
       nullif(u.raw_user_meta_data->>'avatar_url', ''),
       nullif(u.raw_user_meta_data->>'langue', '')
from auth.users u
on conflict (id) do nothing;

-- ── 4. Le monogramme de Google n'est pas une photo ─────────
--
-- Le déclencheur recopiait « picture » dans avatar_url. Or un compte
-- Google sans photo en reçoit une quand même : Google la fabrique, la
-- première lettre du prénom sur un fond terne. C'est de là que venait
-- le grand W au milieu de « Gérer mon compte », et il revenait de la
-- base à chaque ouverture de session.
--
-- Seule une photo déposée par le candidat est une photo.

create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profils (id, email, prenom, nom, pseudo, couleur, avatar_url, langue)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'prenom', ''),
             nullif(new.raw_user_meta_data->>'given_name', '')),
    coalesce(nullif(new.raw_user_meta_data->>'nom', ''),
             nullif(new.raw_user_meta_data->>'family_name', '')),
    nullif(new.raw_user_meta_data->>'pseudo', ''),
    nullif(new.raw_user_meta_data->>'couleur', ''),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'langue', '')
  )
  on conflict (id) do update set
    email      = excluded.email,
    prenom     = coalesce(excluded.prenom,     public.profils.prenom),
    nom        = coalesce(excluded.nom,        public.profils.nom),
    pseudo     = coalesce(excluded.pseudo,     public.profils.pseudo),
    couleur    = coalesce(excluded.couleur,    public.profils.couleur),
    avatar_url = coalesce(excluded.avatar_url, public.profils.avatar_url),
    langue     = coalesce(excluded.langue,     public.profils.langue);
  return new;
end;
$$;

-- ── Vérification ───────────────────────────────────────────
-- Après le Run, cette requête ne doit renvoyer AUCUNE ligne.
-- Si elle en renvoie une, le point 1 n'a pas pris.

select column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'profils'
  and grantee      = 'authenticated'
  and privilege_type = 'UPDATE'
  and column_name in ('premium', 'plan', 'premium_jusqu_au', 'stripe_client_id');
