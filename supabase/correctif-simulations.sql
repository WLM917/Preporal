-- ═══════════════════════════════════════════════════════════
--  correctif-simulations.sql
--  À coller dans Supabase → SQL Editor, puis Run.
--  Rejouable autant de fois qu'on veut, sans rien casser.
--
--  L'historique appartient au COMPTE, pas à l'appareil.
--
--  Jusqu'ici, la table ne gardait qu'une trace de progression :
--  type d'oral, note, critères, nombre de questions. Les
--  questions posées, les réponses et la correction restaient dans
--  le navigateur où la simulation avait eu lieu — se connecter
--  depuis un autre appareil ne montrait donc qu'une note.
--
--  Ces cinq colonnes portent le détail. Ce qui n'y entre pas, et
--  n'y entrera pas : le fichier de CV, le sujet déposé, l'audio.
--  Ils sont lus dans le navigateur, servent à produire les
--  questions, et ne remontent jamais.
-- ═══════════════════════════════════════════════════════════

alter table public.simulations add column if not exists reponses         jsonb  default '[]'::jsonb;
alter table public.simulations add column if not exists eloquence_detail jsonb;
alter table public.simulations add column if not exists verdict          text;
alter table public.simulations add column if not exists temps_total      int;
alter table public.simulations add column if not exists details          jsonb  default '[]'::jsonb;

-- Les règles d'accès existaient déjà et restent les bonnes : chacun
-- ne lit, n'écrit et n'efface que ses propres simulations. On les
-- repose ici pour que ce fichier suffise à lui seul.

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

-- ── Vérification ───────────────────────────────────────────
-- Après le Run, cette requête doit renvoyer 5 lignes.

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'simulations'
  and column_name in ('reponses', 'eloquence_detail', 'verdict', 'temps_total', 'details')
order by column_name;
