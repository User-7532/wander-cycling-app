-- Let event organizers optionally restrict who can view the RSVP breakdown
-- (who's 参加/不参加/未回答) on an event. Previously this was hardcoded to
-- officer+ only, which confused the club owner (the club uses no "担当者"
-- terminology elsewhere). New default: anyone who can see the event at all
-- can see the breakdown; organizers can opt into a hand-picked viewer list
-- via a checkbox in the event form. Mirrors the club_events.visibility /
-- event_invitees pattern (0015_event_visibility.sql) and the
-- announcements.visibility / announcement_recipients pattern
-- (0039_announcement_targeting.sql).

alter table club_events
  add column rsvp_visibility text not null default 'all' check (rsvp_visibility in ('all', 'restricted'));

create table event_rsvp_viewers (
  event_id uuid not null references club_events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  primary key (event_id, profile_id)
);

alter table event_rsvp_viewers enable row level security;

-- Any authenticated member can read this table -- the frontend needs to
-- check "am I in this event's viewer list" for arbitrary events, which is a
-- weaker read requirement than event_invitees (which gates event
-- visibility itself). Write access mirrors the "executive write
-- club_events" policy (0010_rls_policies.sql) -- only whoever can already
-- edit the event can change who's allowed to view its RSVP breakdown.
create policy "read event_rsvp_viewers" on event_rsvp_viewers
  for select using (auth.uid() is not null);
create policy "executive write event_rsvp_viewers" on event_rsvp_viewers
  for insert with check (is_executive());
create policy "executive delete event_rsvp_viewers" on event_rsvp_viewers
  for delete using (is_executive());
