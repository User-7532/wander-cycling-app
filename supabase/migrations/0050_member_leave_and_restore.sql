-- Self-service "退部する" (leave the club): members occasionally register by
-- mistake, or actually retire, and want a way to remove themselves from the
-- app entirely -- not just log out. The club owner explicitly wants this to
-- be self-service (any member, not admin-only), but recoverable, since
-- people worried aloud about an accidental click ("間違えて登録解除しても復旧
-- できるように"). So this is a soft-delete: the profile row is never
-- touched destructively, it's just hidden from the roster and marked with
-- when it happened, and an executive can undo it.
--
-- 1. profiles.left_at: null = active member, set = they've left. Nothing
-- reads/writes it except the two functions below and the roster queries
-- updated to filter it out.
alter table profiles add column left_at timestamptz null;

-- 2. Audit trail of leave/restore actions -- lets a confused executive
-- figure out what happened if someone reports "I didn't mean to click
-- that." Internal-only: no direct insert/update/delete from the client (no
-- policy for those operations at all), writes happen exclusively through
-- the SECURITY DEFINER functions below, which bypass RLS as the
-- table-owning role the same way every other SECURITY DEFINER function in
-- this project does (e.g. profiles_directory()). Read access is
-- executive-only since this is an internal log, not member-facing content.
create table profile_leave_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  event_type text not null check (event_type in ('left', 'restored')),
  occurred_at timestamptz not null default now(),
  actor_id uuid references profiles(id)
);

alter table profile_leave_events enable row level security;

create policy "executive read profile_leave_events" on profile_leave_events
  for select using (is_executive());

-- 3. leave_club(): no args, operates on auth.uid() only -- a member can
-- only ever remove themselves, never anyone else. Mirrors the
-- OB-retirement role-clear technique in
-- supabase/functions/update-member-status-attributes/index.ts, but
-- deliberately does NOT catch a lockout block the way that function's loop
-- does (that catch exists there so one blocked profile in a batch doesn't
-- roll back everyone else's clear) -- here there's only ever one profile
-- involved, so if clearing this person's roles would drop the club to zero
-- アプリ管理者, the delete raises via
-- prevent_zero_executive_lockout_profile_roles (0045) and that exception
-- is left to propagate, aborting the entire function/transaction: left_at
-- is never set and no event row is written, so a sole executive literally
-- cannot leave without first handing off their role to someone else --
-- exactly like the OB path.
create or replace function leave_club() returns void
language plpgsql security definer set search_path = public as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'ログインが必要です' using errcode = 'P0001';
  end if;

  -- Clear every role this profile currently holds. Zero rows is a no-op
  -- (no trigger fires), so members with no roles fall straight through.
  delete from profile_roles where profile_id = caller;

  update profiles set left_at = now() where id = caller;

  insert into profile_leave_events (profile_id, event_type, actor_id)
  values (caller, 'left', caller);
end;
$$;

revoke all on function leave_club() from public;
grant execute on function leave_club() to authenticated;

-- 4. restore_member(): executive-only undo. Checked inside the function
-- body (not just via the GRANT below) so the permission check can't be
-- bypassed by anything that might reach this function with elevated
-- privileges -- mirrors how every other executive-gated write in this
-- project checks is_executive() explicitly rather than relying solely on
-- RLS/grants.
create or replace function restore_member(target_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_executive() then
    raise exception '権限がありません: この操作はアプリ管理者のみ実行できます。' using errcode = 'P0001';
  end if;

  update profiles set left_at = null where id = target_profile_id;

  insert into profile_leave_events (profile_id, event_type, actor_id)
  values (target_profile_id, 'restored', auth.uid());
end;
$$;

revoke all on function restore_member(uuid) from public;
grant execute on function restore_member(uuid) to authenticated;

-- 5. profiles_directory() (0013, most recently redefined in
-- 0044_profile_social_gallery.sql) is the roster view every non-yakuin
-- member queries -- exclude left members so they vanish from the general
-- roster the moment leave_club() runs. Return type is unchanged from 0044
-- so `create or replace` (no drop) is enough here.
create or replace function profiles_directory()
returns table (id uuid, full_name text, avatar_url text, year text, club_role_id smallint, bio text)
language sql stable security definer set search_path = public as $$
  select id, full_name, avatar_url, year, club_role_id, bio
  from profiles
  where auth.uid() is not null and left_at is null
$$;

-- Note: notification-sending Edge Functions (broadcast/reminder) are NOT
-- updated here to exclude left members from their targeting queries --
-- that's a known, deliberately out-of-scope follow-up.
