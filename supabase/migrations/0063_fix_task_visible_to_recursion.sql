-- 0062's "self read own task visibility row" policy made task_visible_to's
-- SELECT policy query tasks, while tasks' own SELECT policy already
-- queries task_visible_to -- Postgres detects that bidirectional reference
-- as infinite recursion (42P17) and refuses to plan the query at all,
-- which broke reading tasks entirely. Revert task_visible_to's policy to
-- its pre-0062 shape (no query back into tasks). The minor metadata
-- tradeoff this reintroduces -- a 三役 who can't see a 'private' task can
-- still see task_visible_to's confirms-the-obvious "who else can see it"
-- list for it -- is a low-severity, low-value privilege that isn't worth a
-- structurally circular RLS policy.
drop policy if exists "self read own task visibility row" on task_visible_to;
create policy "self read own task visibility row" on task_visible_to for select using (
  profile_id = auth.uid() or is_executive() or is_yakuin()
);
