-- Task visibility overhaul: previously any 担当者以上(officer+) saw every
-- task, which got cluttered. Narrows default broad visibility to 三役
-- (is_yakuin) and アプリ管理者(is_executive) -- who together already have
-- full task management rights -- while everyone else only sees tasks
-- they're assigned to, tasks marked fully public, or tasks a creator
-- (always an executive, since only executives can create tasks) has
-- explicitly opened up to them. Mirrors the club_events
-- visibility/event_invitees pattern (0015_event_visibility.sql).

create or replace function is_yakuin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_roles pr
    join club_roles cr on cr.id = pr.club_role_id
    where pr.profile_id = auth.uid() and cr.is_yakuin = true
  )
$$;

alter table tasks
  add column if not exists visibility text not null default 'restricted' check (visibility in ('all', 'restricted'));

create table if not exists task_visible_to (
  task_id uuid not null references tasks(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  primary key (task_id, profile_id)
);
alter table task_visible_to enable row level security;

drop policy if exists "officer+ read all tasks" on tasks;
drop policy if exists "read own assigned task" on tasks;

create policy "read visible tasks" on tasks for select using (
  is_executive()
  or is_yakuin()
  or assigned_to = auth.uid()
  or visibility = 'all'
  or exists (select 1 from task_visible_to tv where tv.task_id = id and tv.profile_id = auth.uid())
);

create policy "self read own task visibility row" on task_visible_to for select using (
  profile_id = auth.uid() or is_executive() or is_yakuin()
);
create policy "executive write task_visible_to" on task_visible_to for all using (is_executive()) with check (is_executive());
