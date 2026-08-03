-- Allow announcements to be sent to a hand-picked subset of members instead
-- of only "everyone". Mirrors the club_events.visibility / event_invitees
-- pattern used for invite-only events (see 0003_content_tables.sql /
-- 0010_rls_policies.sql).

alter table announcements
  add column visibility text not null default 'all' check (visibility in ('all', 'targeted'));

create table announcement_recipients (
  announcement_id uuid not null references announcements(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  primary key (announcement_id, profile_id)
);

alter table announcement_recipients enable row level security;

-- announcements itself is executive-only for every write (insert/update/delete
-- all go through the single "executive write announcements" policy), so the
-- recipients list -- which is only ever populated as part of creating/editing
-- an announcement -- uses the same is_executive() gate for read and write,
-- for consistency with that policy rather than introducing a new tier split.
create policy "executive read announcement_recipients" on announcement_recipients
  for select using (is_executive());
create policy "executive write announcement_recipients" on announcement_recipients
  for insert with check (is_executive());
create policy "executive delete announcement_recipients" on announcement_recipients
  for delete using (is_executive());
