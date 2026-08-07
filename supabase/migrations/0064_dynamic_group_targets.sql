-- Every "who can see this / who is this targeted at" table
-- (task_visible_to, announcement_recipients, event_invitees,
-- event_rsvp_viewers) previously only stored resolved profile_id rows --
-- a snapshot of who matched a filter at selection time. Someone who later
-- gains that same attribute/role was never retroactively included, since
-- nothing remembered *why* the original people were added.
--
-- This lets a target row reference an attribute value or club role
-- directly instead of a specific profile, so membership stays live. The
-- existing "filter by attribute/role, flip-select the matching
-- individuals" picker is UNCHANGED and still produces plain profile_id
-- rows -- this adds a second, parallel kind of row alongside it, it
-- doesn't replace it.

create or replace function member_matches_target(
  p_profile_id uuid,
  p_target_profile_id uuid,
  p_target_attribute_value_id uuid,
  p_target_club_role_id smallint
) returns boolean
language sql stable as $$
  select
    p_target_profile_id = p_profile_id
    or (p_target_attribute_value_id is not null and exists (
      select 1 from profile_attribute_values pav
      where pav.attribute_value_id = p_target_attribute_value_id and pav.profile_id = p_profile_id
    ))
    or (p_target_club_role_id is not null and exists (
      select 1 from profile_roles pr
      where pr.club_role_id = p_target_club_role_id and pr.profile_id = p_profile_id
    ))
$$;

-- task_visible_to -------------------------------------------------------------

alter table task_visible_to drop constraint task_visible_to_pkey;
alter table task_visible_to alter column profile_id drop not null;
alter table task_visible_to add column attribute_value_id uuid references member_attribute_values(id) on delete cascade;
alter table task_visible_to add column club_role_id smallint references club_roles(id) on delete cascade;
alter table task_visible_to add column id uuid not null default gen_random_uuid() primary key;
create unique index task_visible_to_profile_uniq on task_visible_to(task_id, profile_id) where profile_id is not null;
create unique index task_visible_to_attr_uniq on task_visible_to(task_id, attribute_value_id) where attribute_value_id is not null;
create unique index task_visible_to_role_uniq on task_visible_to(task_id, club_role_id) where club_role_id is not null;
alter table task_visible_to add constraint task_visible_to_target_check check (
  (profile_id is not null)::int + (attribute_value_id is not null)::int + (club_role_id is not null)::int = 1
);

drop policy if exists "read visible tasks" on tasks;
create policy "read visible tasks" on tasks for select using (
  visibility = 'all'
  or is_executive()
  or assigned_to = auth.uid()
  or exists (select 1 from task_visible_to tv where tv.task_id = id and member_matches_target(auth.uid(), tv.profile_id, tv.attribute_value_id, tv.club_role_id))
  or (visibility = 'restricted' and is_yakuin())
);

drop policy if exists "self read own task visibility row" on task_visible_to;
create policy "self read own task visibility row" on task_visible_to for select using (
  member_matches_target(auth.uid(), profile_id, attribute_value_id, club_role_id) or is_executive() or is_yakuin()
);

create or replace function resolve_task_visible_to(p_task_id uuid) returns setof uuid
language sql stable as $$
  select profile_id from task_visible_to where task_id = p_task_id and profile_id is not null
  union
  select pav.profile_id from task_visible_to tv join profile_attribute_values pav on pav.attribute_value_id = tv.attribute_value_id where tv.task_id = p_task_id
  union
  select pr.profile_id from task_visible_to tv join profile_roles pr on pr.club_role_id = tv.club_role_id where tv.task_id = p_task_id
$$;

-- announcement_recipients -------------------------------------------------------

alter table announcement_recipients drop constraint announcement_recipients_pkey;
alter table announcement_recipients alter column profile_id drop not null;
alter table announcement_recipients add column attribute_value_id uuid references member_attribute_values(id) on delete cascade;
alter table announcement_recipients add column club_role_id smallint references club_roles(id) on delete cascade;
alter table announcement_recipients add column id uuid not null default gen_random_uuid() primary key;
create unique index announcement_recipients_profile_uniq on announcement_recipients(announcement_id, profile_id) where profile_id is not null;
create unique index announcement_recipients_attr_uniq on announcement_recipients(announcement_id, attribute_value_id) where attribute_value_id is not null;
create unique index announcement_recipients_role_uniq on announcement_recipients(announcement_id, club_role_id) where club_role_id is not null;
alter table announcement_recipients add constraint announcement_recipients_target_check check (
  (profile_id is not null)::int + (attribute_value_id is not null)::int + (club_role_id is not null)::int = 1
);

drop policy if exists "read visible announcements" on announcements;
create policy "read visible announcements" on announcements for select using (
  is_officer_or_above()
  or visibility = 'all'
  or exists (select 1 from announcement_recipients ar where ar.announcement_id = id and member_matches_target(auth.uid(), ar.profile_id, ar.attribute_value_id, ar.club_role_id))
);

create or replace function resolve_announcement_recipients(p_announcement_id uuid) returns setof uuid
language sql stable as $$
  select profile_id from announcement_recipients where announcement_id = p_announcement_id and profile_id is not null
  union
  select pav.profile_id from announcement_recipients ar join profile_attribute_values pav on pav.attribute_value_id = ar.attribute_value_id where ar.announcement_id = p_announcement_id
  union
  select pr.profile_id from announcement_recipients ar join profile_roles pr on pr.club_role_id = ar.club_role_id where ar.announcement_id = p_announcement_id
$$;

-- event_invitees ----------------------------------------------------------------

alter table event_invitees drop constraint event_invitees_pkey;
alter table event_invitees alter column profile_id drop not null;
alter table event_invitees add column attribute_value_id uuid references member_attribute_values(id) on delete cascade;
alter table event_invitees add column club_role_id smallint references club_roles(id) on delete cascade;
alter table event_invitees add column id uuid not null default gen_random_uuid() primary key;
create unique index event_invitees_profile_uniq on event_invitees(event_id, profile_id) where profile_id is not null;
create unique index event_invitees_attr_uniq on event_invitees(event_id, attribute_value_id) where attribute_value_id is not null;
create unique index event_invitees_role_uniq on event_invitees(event_id, club_role_id) where club_role_id is not null;
alter table event_invitees add constraint event_invitees_target_check check (
  (profile_id is not null)::int + (attribute_value_id is not null)::int + (club_role_id is not null)::int = 1
);

drop policy if exists "read visible club_events" on club_events;
create policy "read visible club_events" on club_events for select using (
  is_officer_or_above()
  or visibility = 'all'
  or exists (select 1 from event_invitees ei where ei.event_id = id and member_matches_target(auth.uid(), ei.profile_id, ei.attribute_value_id, ei.club_role_id))
);

drop policy if exists "self read own invites" on event_invitees;
create policy "self read own invites" on event_invitees for select using (
  member_matches_target(auth.uid(), profile_id, attribute_value_id, club_role_id) or is_officer_or_above()
);

create or replace function resolve_event_invitees(p_event_id uuid) returns setof uuid
language sql stable as $$
  select profile_id from event_invitees where event_id = p_event_id and profile_id is not null
  union
  select pav.profile_id from event_invitees ei join profile_attribute_values pav on pav.attribute_value_id = ei.attribute_value_id where ei.event_id = p_event_id
  union
  select pr.profile_id from event_invitees ei join profile_roles pr on pr.club_role_id = ei.club_role_id where ei.event_id = p_event_id
$$;

-- event_rsvp_viewers --------------------------------------------------------------
-- No push mechanism reads this one (it only gates who sees the RSVP
-- breakdown in-app), but it uses the same picker pattern, so the same
-- live-membership benefit applies -- extended for consistency.

alter table event_rsvp_viewers drop constraint event_rsvp_viewers_pkey;
alter table event_rsvp_viewers alter column profile_id drop not null;
alter table event_rsvp_viewers add column attribute_value_id uuid references member_attribute_values(id) on delete cascade;
alter table event_rsvp_viewers add column club_role_id smallint references club_roles(id) on delete cascade;
alter table event_rsvp_viewers add column id uuid not null default gen_random_uuid() primary key;
create unique index event_rsvp_viewers_profile_uniq on event_rsvp_viewers(event_id, profile_id) where profile_id is not null;
create unique index event_rsvp_viewers_attr_uniq on event_rsvp_viewers(event_id, attribute_value_id) where attribute_value_id is not null;
create unique index event_rsvp_viewers_role_uniq on event_rsvp_viewers(event_id, club_role_id) where club_role_id is not null;
alter table event_rsvp_viewers add constraint event_rsvp_viewers_target_check check (
  (profile_id is not null)::int + (attribute_value_id is not null)::int + (club_role_id is not null)::int = 1
);

-- No edge function reads this one, but the frontend needs a way to check
-- "can I see this event's RSVP breakdown" without reimplementing the
-- attribute/role matching in client JS.
create or replace function resolve_event_rsvp_viewers(p_event_id uuid) returns setof uuid
language sql stable as $$
  select profile_id from event_rsvp_viewers where event_id = p_event_id and profile_id is not null
  union
  select pav.profile_id from event_rsvp_viewers rv join profile_attribute_values pav on pav.attribute_value_id = rv.attribute_value_id where rv.event_id = p_event_id
  union
  select pr.profile_id from event_rsvp_viewers rv join profile_roles pr on pr.club_role_id = rv.club_role_id where rv.event_id = p_event_id
$$;
