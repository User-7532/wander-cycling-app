-- Closes a gap: "targeted" announcements were only gated at the
-- announcement_recipients level (0039_announcement_targeting.sql) -- the
-- base "read announcements" policy (0010_rls_policies.sql) never checked
-- visibility at all, so any signed-in member could still select a targeted
-- announcement's title/body directly, just not see it listed as a
-- recipient. Mirrors the exact club_events/event_invitees select policy
-- (0015_event_visibility.sql): officer+ see everything (needed to manage
-- announcements they didn't personally target), everyone else sees
-- visibility='all' ones plus any 'targeted' one they're a recipient of.
drop policy if exists "read announcements" on announcements;
create policy "read visible announcements" on announcements for select using (
  is_officer_or_above()
  or visibility = 'all'
  or exists (select 1 from announcement_recipients ar where ar.announcement_id = id and ar.profile_id = auth.uid())
);
