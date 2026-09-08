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
  premium           boolean not null default false,
  plan              text,                       -- 'mensuel' | 'pass48'
  premium_jusqu_au  timestamptz,                -- null = abonnement récurrent
  stripe_client_id  text unique,
  cree_le           timestamptz not null default now(),
  maj_le            timestamptz not null default now()
);

alter table public.profils enable row level security;

drop policy if exists "profil visible par son proprietaire" on public.profils;
create policy "profil visible par son proprietaire"
  on public.profils for select using (auth.uid() = id);

drop policy if exists "profil modifiable par son proprietaire" on public.profils;
create policy "profil modifiable par son proprietaire"
  on public.profils for update using (auth.uid() = id);

-- Création automatique du profil à l'inscription
create or replace function public.creer_profil()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profils (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
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
