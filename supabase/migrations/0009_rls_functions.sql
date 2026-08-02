-- Helper functions used by every RLS policy below, so tier logic lives in one
-- place instead of being repeated per table.
create or replace function current_tier() returns text
language sql stable security definer set search_path = public as $$
  select cr.tier
  from profiles p
  join club_roles cr on cr.id = p.club_role_id
  where p.id = auth.uid()
$$;

create or replace function is_executive() returns boolean
language sql stable security definer set search_path = public as $$
  select current_tier() = 'executive'
$$;

create or replace function is_officer_or_above() returns boolean
language sql stable security definer set search_path = public as $$
  select current_tier() in ('executive', 'officer')
$$;
