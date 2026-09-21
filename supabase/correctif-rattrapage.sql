-- ═══════════════════════════════════════════════════════════
--  correctif-rattrapage.sql
--  À coller dans Supabase → SQL Editor, puis Run.
--  Rejouable autant de fois qu'on veut, sans rien casser.
--
--  Une simulation peut avoir son détail dans le navigateur et
--  pas en base : réseau coupé au moment de l'enregistrement,
--  colonnes pas encore créées, serveur qui a refusé. Rien ne
--  retentait, et ce détail restait prisonnier de l'appareil où
--  la simulation avait eu lieu.
--
--  Le site le remonte désormais au chargement suivant. Il lui
--  faut pour cela le droit de compléter une ligne existante —
--  il ne l'avait pas : créer, lire et effacer, rien d'autre.
-- ═══════════════════════════════════════════════════════════

-- ── Le droit de compléter, et lui seul ─────────────────────
--
-- Les colonnes sont énumérées, comme pour profils. Une règle RLS
-- choisit quelles LIGNES on peut modifier, jamais quelles COLONNES :
-- sans cette restriction, un compte pourrait réécrire sa propre note,
-- ou déplacer une simulation chez quelqu'un d'autre en changeant
-- utilisateur_id.

drop policy if exists "simulations completables par leur auteur" on public.simulations;
create policy "simulations completables par leur auteur"
  on public.simulations for update
  using       (auth.uid() = utilisateur_id)
  with check  (auth.uid() = utilisateur_id);

revoke update on public.simulations from authenticated, anon;
grant  update (reponses, eloquence_detail, verdict, temps_total, details)
  on public.simulations to authenticated;

-- ── Vérification ───────────────────────────────────────────
-- Après le Run, cette requête doit renvoyer 5 lignes — et
-- uniquement celles-là. Ni « score », ni « utilisateur_id ».

select column_name
from information_schema.column_privileges
where table_schema   = 'public'
  and table_name     = 'simulations'
  and grantee        = 'authenticated'
  and privilege_type = 'UPDATE'
order by column_name;
