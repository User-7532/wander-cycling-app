-- Support holding multiple positions concurrently (兼任), e.g. someone
-- being both 広報 and メカ at once, without rewriting the dozens of
-- existing frontend queries that join profiles.club_role_id ->
-- club_roles(label_ja, tier, is_yakuin) expecting a single role.
--
-- profiles.club_role_id is NOT removed and NOT stopped-being-populated.
-- Instead:
--   1. profile_roles is the new source of truth for the *full* set of
--      roles a profile currently holds.
--   2. profiles.club_role_id is kept in sync as that profile's "primary"
--      role -- the highest-tier role among their current profile_roles
--      rows (tie-broken by lowest club_roles.id, i.e. earliest-defined) --
--      via an AFTER trigger on profile_roles. Every existing single-role
--      read across the app therefore keeps working and always reflects
--      the person's highest current role.
--   3. current_tier() (and therefore is_executive() /
--      is_officer_or_above(), which are unchanged -- they just call
--      current_tier()) is rewritten to compute the *union* of tiers across
--      all of auth.uid()'s profile_roles rows, so someone holding an
--      executive-tier role alongside an officer-tier one is treated as
--      executive for permission purposes even when it isn't their
--      "primary" display role. Concretely it now returns the *highest*
--      tier across all held roles, which is equivalent to "true if ANY
--      held role is executive-tier" for is_executive(), etc.
--   4. The zero-executive lockout safeguard (0038) is extended to
--      profile_roles: removing (or reassigning away from executive-tier)
--      a profile_roles row is blocked if it would drop the app-wide
--      executive-tier profile_roles count to zero. This fires BEFORE the
--      row is removed, i.e. before the AFTER-trigger primary-role
--      recompute ever runs, so an unsafe removal never reaches the
--      recompute step at all. The existing trigger on profiles.club_role_id
--      keeps working unchanged and continues to protect any *direct*
--      profiles.club_role_id write (e.g. from other code paths); in the
--      normal profile_roles-driven flow it now just re-validates a change
--      that the profile_roles-level trigger already deemed safe, so it
--      never actually fires an exception in that path.

-- 1. New table: the full set of roles a profile currently holds.
create table profile_roles (
  profile_id uuid not null references profiles(id) on delete cascade,
  club_role_id smallint not null references club_roles(id),
  assigned_at timestamptz not null default now(),
  primary key (profile_id, club_role_id)
);

alter table profile_roles enable row level security;

-- Same read/write shape as club_roles/member_attributes: any signed-in
-- member can read (needed to render "this person also holds X" in the
-- directory), executive-only write (mirrors who can currently write
-- profiles.club_role_id via the "executive write any profile" policy).
create policy "read profile_roles" on profile_roles
  for select using (auth.uid() is not null);
create policy "executive write profile_roles" on profile_roles
  for all using (is_executive()) with check (is_executive());

-- 2. Backfill: one profile_roles row per existing profile's current
-- non-null club_role_id (all profiles.club_role_id values are non-null --
-- the column is NOT NULL with a default -- so this covers every profile).
insert into profile_roles (profile_id, club_role_id)
select id, club_role_id from profiles
on conflict do nothing;

-- 3. Keep profiles.club_role_id synced to the highest-tier role among a
-- profile's current profile_roles rows. SECURITY INVOKER (the default --
-- no `security definer` here) is deliberate: this UPDATE should run with
-- the same privileges/RLS/trigger exposure as whatever caller changed
-- profile_roles, so it composes correctly with the existing
-- prevent_self_role_escalation and prevent_zero_executive_lockout
-- triggers on profiles instead of bypassing them. In practice the only
-- callers who can reach this (per the RLS policy above) are executives or
-- the service role, both of which are already allowed to write
-- profiles.club_role_id directly today.
create or replace function sync_primary_club_role() returns trigger
language plpgsql as $$
declare
  affected_profile uuid;
  best_role_id smallint;
begin
  affected_profile := coalesce(NEW.profile_id, OLD.profile_id);

  select pr.club_role_id into best_role_id
  from profile_roles pr
  join club_roles cr on cr.id = pr.club_role_id
  where pr.profile_id = affected_profile
  order by
    case cr.tier
      when 'executive' then 1
      when 'officer' then 2
      when 'general' then 3
      when 'alumni' then 4
      else 5
    end,
    cr.id
  limit 1;

  -- A profile left with zero profile_roles rows (all of their roles
  -- removed) falls back to the same seeded general/一般部員 role (id 13)
  -- that profiles.club_role_id already defaults new profiles to, since
  -- the column is NOT NULL and can never be left without some role.
  if best_role_id is null then
    best_role_id := 13;
  end if;

  update profiles
  set club_role_id = best_role_id
  where id = affected_profile
    and club_role_id is distinct from best_role_id;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_primary_club_role on profile_roles;
create trigger trg_sync_primary_club_role
  after insert or update or delete on profile_roles
  for each row execute function sync_primary_club_role();

-- 4. Rewrite current_tier() to compute the highest tier across the union
-- of auth.uid()'s current profile_roles rows, instead of reading the
-- single profiles.club_role_id column. is_executive() and
-- is_officer_or_above() are intentionally left untouched -- they already
-- just call current_tier(), so returning the *highest* held tier here
-- automatically makes is_executive() true whenever ANY currently-held
-- role is executive-tier (true 兼任 support), not just the primary one.
create or replace function public.current_tier()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select cr.tier
  from profile_roles pr
  join club_roles cr on cr.id = pr.club_role_id
  where pr.profile_id = auth.uid()
  order by
    case cr.tier
      when 'executive' then 1
      when 'officer' then 2
      when 'general' then 3
      when 'alumni' then 4
      else 5
    end
  limit 1
$function$;

-- 5. Extend the zero-executive lockout to profile_roles. Mirrors
-- prevent_zero_executive_lockout (0038) but counts remaining
-- executive-tier profile_roles rows app-wide (across all profiles, not
-- just this one), since a profile can now hold an executive-tier role
-- alongside others. Fires BEFORE the row is actually removed/reassigned,
-- so if it raises, the whole statement (and any other rows it touches)
-- is rolled back before trg_sync_primary_club_role ever runs -- the
-- primary-role recompute never sees, let alone acts on, a blocked
-- removal.
create or replace function prevent_zero_executive_lockout_profile_roles() returns trigger
language plpgsql as $$
declare
  old_tier text;
  new_tier text;
  remaining_executives int;
begin
  select cr.tier into old_tier from club_roles cr where cr.id = OLD.club_role_id;

  -- This row wasn't an executive-tier role to begin with, so removing/
  -- reassigning it can't be the operation that empties the executive
  -- tier.
  if old_tier is distinct from 'executive' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'UPDATE' then
    select cr.tier into new_tier from club_roles cr where cr.id = NEW.club_role_id;
    -- Still an executive-tier row for the same profile after the update
    -- (e.g. reassigned between two executive-tier codes) -- no risk of
    -- losing the last executive.
    if new_tier = 'executive' and NEW.profile_id = OLD.profile_id then
      return NEW;
    end if;
  end if;

  -- OLD was an executive-tier role assignment being removed (deleted, or
  -- updated away to a different role/profile). Block only if no other
  -- executive-tier profile_roles row would remain app-wide.
  select count(*) into remaining_executives
  from profile_roles pr
  join club_roles cr on cr.id = pr.club_role_id
  where cr.tier = 'executive'
    and not (pr.profile_id = OLD.profile_id and pr.club_role_id = OLD.club_role_id);

  if remaining_executives = 0 then
    raise exception 'この操作はできません: アプリ管理者(executive)の役職が0件になってしまいます。先に別のメンバーをアプリ管理者に昇格させてから、この変更を行ってください。'
      using errcode = 'P0001';
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_prevent_zero_executive_lockout_profile_roles on profile_roles;
create trigger trg_prevent_zero_executive_lockout_profile_roles
  before update or delete on profile_roles
  for each row execute function prevent_zero_executive_lockout_profile_roles();
