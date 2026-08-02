alter table club_events
  add column if not exists visibility text not null default 'all' check (visibility in ('all', 'invite_only'));

create table if not exists event_invitees (
  event_id uuid not null references club_events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  primary key (event_id, profile_id)
);

alter table event_invitees enable row level security;

-- Replace the old "everyone sees every event" policy: officer+ still see
-- everything (they organize), others only see public events or ones they're
-- personally invited to.
drop policy if exists "read club_events" on club_events;

create policy "read visible club_events" on club_events for select using (
  is_officer_or_above()
  or visibility = 'all'
  or exists (select 1 from event_invitees ei where ei.event_id = id and ei.profile_id = auth.uid())
);

create policy "self read own invites" on event_invitees for select using (
  profile_id = auth.uid() or is_officer_or_above()
);
create policy "executive write invites" on event_invitees for all using (is_executive()) with check (is_executive());
