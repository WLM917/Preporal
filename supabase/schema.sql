-- ═══════════════════════════════════════════════════════════
--  PrepOral — schéma Supabase
--  À exécuter dans Supabase → SQL Editor.
--  Toutes les tables sont protégées par RLS : un utilisateur
--  ne voit que ses propres lignes. Les fonctions serverless
--  utilisent la clé service_role et contournent ces règles.
-- ═══════════════════════════════════════════════════════════

-- ── Profils ────────────────────────────────────────────────
create table if not exists public.profils (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text,
  prenom            text,
  nom               text,
  pseudo            text,                       -- affiché à la place de l'adresse
  telephone         text,                       -- facultatif
  couleur           text,                       -- teinte de la pastille sans photo
  avatar_url        text,
  langue            text,                       -- 'fr' | 'en' | 'es'
  premium           boolean not null default false,
  plan              text,                       -- 'mensuel' | 'pass48'
  premium_jusqu_au  timestamptz,                -- null = abonnement récurrent
  stripe_client_id  text unique,
  cree_le           timestamptz not null default now(),
  maj_le            timestamptz not null default now()
);

-- Pour un projet créé avant l'ajout du formulaire d'inscription.
alter table public.profils add column if not exists prenom text;
alter table public.profils add column if not exists nom text;
alter table public.profils add column if not exists pseudo text;
alter table public.profils add column if not exists telephone text;
alter table public.profils add column if not exists couleur text;
alter table public.profils add column if not exists avatar_url text;
alter table public.profils add column if not exists langue text;

alter table public.profils enable row level security;

drop policy if exists "profil visible par son proprietaire" on public.profils;
create policy "profil visible par son proprietaire"
  on public.profils for select using (auth.uid() = id);

drop policy if exists "profil modifiable par son proprietaire" on public.profils;
create policy "profil modifiable par son proprietaire"
  on public.profils for update using (auth.uid() = id);

-- Création automatique du profil à l'inscription.
-- Le prénom, le nom et la langue sont joints au compte par
-- js/auth.js (options.data de signUp) : ils arrivent ici dans
-- raw_user_meta_data. Les recopier dans « profils » les rend
-- lisibles depuis le Table Editor, et interrogeables en SQL —
-- la liste Authentication → Users, elle, n'affiche que l'adresse.
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profils (id, email, prenom, nom, pseudo, couleur, avatar_url, langue)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'prenom', ''),
    nullif(new.raw_user_meta_data->>'nom', ''),
    nullif(new.raw_user_meta_data->>'pseudo', ''),
    nullif(new.raw_user_meta_data->>'couleur', ''),
    -- Google et les autres fournisseurs apportent déjà une photo.
    coalesce(nullif(new.raw_user_meta_data->>'avatar_url', ''),
             nullif(new.raw_user_meta_data->>'picture', '')),
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

drop trigger if exists au_nouvel_utilisateur on auth.users;
create trigger au_nouvel_utilisateur
  after insert on auth.users
  for each row execute function public.creer_profil();

-- ── Historique des simulations ─────────────────────────────
-- Aucun contenu de CV ni de réponse n'est stocké : uniquement
-- des métadonnées de progression.
create table if not exists public.simulations (
  id              uuid primary key default gen_random_uuid(),
  utilisateur_id  uuid not null references auth.users(id) on delete cascade,
  type_id         text not null,
  sous_choix      text,
  score           int  check (score between 0 and 100),
  eloquence       int  check (eloquence between 0 and 20),
  nb_questions    int,
  criteres        jsonb default '{}'::jsonb,
  cree_le         timestamptz not null default now()
);

create index if not exists simulations_utilisateur_date
  on public.simulations (utilisateur_id, cree_le desc);

alter table public.simulations enable row level security;

drop policy if exists "simulations lisibles par leur auteur" on public.simulations;
create policy "simulations lisibles par leur auteur"
  on public.simulations for select using (auth.uid() = utilisateur_id);

drop policy if exists "simulations creees par leur auteur" on public.simulations;
create policy "simulations creees par leur auteur"
  on public.simulations for insert with check (auth.uid() = utilisateur_id);

drop policy if exists "simulations supprimables par leur auteur" on public.simulations;
create policy "simulations supprimables par leur auteur"
  on public.simulations for delete using (auth.uid() = utilisateur_id);

-- ── Avis utilisateurs ──────────────────────────────────────
-- publie = false par défaut : un avis n'apparaît publiquement
-- qu'après modération, pour rester conforme au droit français.
create table if not exists public.avis (
  id              uuid primary key default gen_random_uuid(),
  utilisateur_id  uuid references auth.users(id) on delete set null,
  nom             text not null,
  statut          text,
  note            int not null check (note between 1 and 5),
  texte           text not null,
  publie          boolean not null default false,
  cree_le         timestamptz not null default now()
);

alter table public.avis enable row level security;

drop policy if exists "avis publies visibles de tous" on public.avis;
create policy "avis publies visibles de tous"
  on public.avis for select using (publie = true);

drop policy if exists "chacun peut deposer un avis" on public.avis;
create policy "chacun peut deposer un avis"
  on public.avis for insert with check (true);

-- ── Quota serveur (optionnel mais recommandé) ──────────────
-- Le compteur côté navigateur est contournable. Cette table
-- permet de faire respecter la limite gratuite côté serveur.
create table if not exists public.usages (
  utilisateur_id  uuid primary key references auth.users(id) on delete cascade,
  simulations     int not null default 0,
  maj_le          timestamptz not null default now()
);

alter table public.usages enable row level security;

drop policy if exists "usage visible par son proprietaire" on public.usages;
create policy "usage visible par son proprietaire"
  on public.usages for select using (auth.uid() = utilisateur_id);

-- ── Quota des visiteurs anonymes ───────────────────────────
-- Les deux simulations offertes sont accordées avant toute
-- création de compte : il faut donc pouvoir les compter sans
-- utilisateur. L'empreinte est un condensé (IP + navigateur +
-- langue + sel serveur) : elle n'est pas réversible et ne
-- constitue pas une donnée directement identifiante.
--
-- Cette table n'est jamais lue depuis le navigateur : seule la
-- clé service_role y accède. Aucune politique RLS n'est donc
-- ouverte, ce qui la rend inaccessible via la clé « anon ».
create table if not exists public.usages_anonymes (
  empreinte    text primary key,
  simulations  int not null default 0,
  maj_le       timestamptz not null default now()
);

alter table public.usages_anonymes enable row level security;
-- Aucune policy : personne n'y accède avec la clé anon.

create index if not exists usages_anonymes_maj
  on public.usages_anonymes (maj_le);

-- Purge conseillée : supprimez les empreintes inactives depuis
-- plus de 6 mois (minimisation RGPD). À planifier via pg_cron.
--   delete from public.usages_anonymes where maj_le < now() - interval '6 months';

-- La table « usages » doit accepter l'écriture par la clé
-- service_role via upsert : on garantit la colonne maj_le.
alter table public.usages
  add column if not exists maj_le timestamptz not null default now();

-- ── Âge déclaré et consentement parental ───────────────────
-- L'article 45 de la loi Informatique et Libertés fixe à 15 ans
-- l'âge du consentement numérique en France : en dessous, le
-- traitement requiert l'accord du titulaire de l'autorité
-- parentale. Le code civil (art. 1145 s.) interdit par ailleurs
-- à un mineur non émancipé de souscrire seul un abonnement.
--
-- On stocke la tranche d'âge déclarée, pas la date de naissance :
-- c'est suffisant pour appliquer la règle et cela évite de
-- collecter une donnée plus précise que nécessaire (minimisation).
alter table public.profils
  add column if not exists tranche_age text
    check (tranche_age in ('moins_15', '15_17', 'majeur')),
  add column if not exists consentement_parental boolean not null default false,
  add column if not exists consentement_parental_le timestamptz,
  add column if not exists email_parent text;

comment on column public.profils.tranche_age is
  'Tranche déclarée par l''utilisateur : moins_15 | 15_17 | majeur';
comment on column public.profils.consentement_parental is
  'Accord du représentant légal, requis sous 15 ans et pour tout paiement par un mineur';

-- ── Épreuve concernée par un avis ──────────────────────────
-- Permet de regrouper les témoignages par type d'oral sur la
-- page dédiée : un candidat au brevet ne cherche pas le retour
-- d'un candidat en école de commerce.
alter table public.avis
  add column if not exists type_oral text;

comment on column public.avis.type_oral is
  'Identifiant d''épreuve (entretien, grand-oral, brevet, concours, pitch, matiere, langue)';


-- ── Photos de profil ───────────────────────────────────────
-- Un compartiment public en lecture (l'URL d'une photo n'a rien de
-- secret), mais où chacun n'écrit que dans son propre dossier :
-- les fichiers sont rangés sous « <identifiant>/… ».
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "photos de profil visibles de tous" on storage.objects;
create policy "photos de profil visibles de tous"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "chacun depose sa photo" on storage.objects;
create policy "chacun depose sa photo"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chacun remplace sa photo" on storage.objects;
create policy "chacun remplace sa photo"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chacun supprime sa photo" on storage.objects;
create policy "chacun supprime sa photo"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
