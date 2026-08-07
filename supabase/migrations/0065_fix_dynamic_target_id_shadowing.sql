-- 0064 gave task_visible_to/announcement_recipients/event_invitees their
-- own surrogate `id` primary key column. That silently broke all three
-- policies it touched: each one's EXISTS subquery had an unqualified `id`
-- reference (`tv.task_id = id`) that used to unambiguously mean the outer
-- table's id (tasks.id / announcements.id / club_events.id) -- but once
-- the inner table gained its own `id` column, normal SQL scoping rules
-- resolve the closer (inner) table first, so `id` silently started
-- meaning the INNER table's own id (`tv.task_id = tv.id`), which is never
-- true. Confirmed via pg_policies: the stored qual literally read
-- `tv.task_id = tv.id`. Caught via a rolled-back RLS simulation where a
-- member who'd just been given a matching attribute still couldn't see a
-- task targeted at that attribute.
--
-- Fix: explicitly alias the outer table in all three policies so the
-- reference can't be shadowed regardless of what columns the inner table
-- has.

drop policy if exists "read visible tasks" on tasks;
create policy "read visible tasks" on tasks for select using (
  visibility = 'all'
  or is_executive()
  or assigned_to = auth.uid()
  or exists (
    select 1 from task_visible_to tv
    where tv.task_id = tasks.id and member_matches_target(auth.uid(), tv.profile_id, tv.attribute_value_id, tv.club_role_id)
  )
  or (visibility = 'restricted' and is_yakuin())
);

drop policy if exists "read visible announcements" on announcements;
create policy "read visible announcements" on announcements for select using (
  is_officer_or_above()
  or visibility = 'all'
  or exists (
    select 1 from announcement_recipients ar
    where ar.announcement_id = announcements.id and member_matches_target(auth.uid(), ar.profile_id, ar.attribute_value_id, ar.club_role_id)
  )
);

drop policy if exists "read visible club_events" on club_events;
create policy "read visible club_events" on club_events for select using (
  is_officer_or_above()
  or visibility = 'all'
  or exists (
    select 1 from event_invitees ei
    where ei.event_id = club_events.id and member_matches_target(auth.uid(), ei.profile_id, ei.attribute_value_id, ei.club_role_id)
  )
);
