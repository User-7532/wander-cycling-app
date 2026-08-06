-- Widen member management (edit profile/roles, and remove_member from
-- 0056) from アプリ管理者-only to アプリ管理者 OR 三役. The Members page has
-- described itself as "三役限定" management since an earlier session, but
-- the actual write policies only ever checked is_executive() -- three-yaku
-- who aren't also tier=executive genuinely couldn't edit anyone. This
-- migration makes the real permission boundary match that description (and
-- the user's own stated expectation that 三役 can already manage members).
--
-- Zero-executive-lockout protection is untouched: prevent_zero_executive_
-- lockout_profile_roles (0045) still fires regardless of who the caller is,
-- so a 三役 member can't accidentally strip the club down to zero アプリ管理者.

drop policy if exists "executive write any profile" on profiles;
create policy "executive or yakuin write any profile" on profiles
  for all using (is_executive() or is_yakuin()) with check (is_executive() or is_yakuin());

drop policy if exists "executive write profile_roles" on profile_roles;
create policy "executive or yakuin write profile_roles" on profile_roles
  for all using (is_executive() or is_yakuin()) with check (is_executive() or is_yakuin());

create or replace function remove_member(target_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_executive() or is_yakuin()) then
    raise exception '権限がありません: この操作はアプリ管理者・三役のみ実行できます。' using errcode = 'P0001';
  end if;

  delete from profile_roles where profile_id = target_profile_id;

  update profiles set left_at = now() where id = target_profile_id;

  insert into profile_leave_events (profile_id, event_type, actor_id)
  values (target_profile_id, 'left', auth.uid());
end;
$$;

-- Symmetric with remove_member() above -- a 三役 who mistakenly removes
-- someone shouldn't need to track down an アプリ管理者 just to undo it.
create or replace function restore_member(target_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_executive() or is_yakuin()) then
    raise exception '権限がありません: この操作はアプリ管理者・三役のみ実行できます。' using errcode = 'P0001';
  end if;

  update profiles set left_at = null where id = target_profile_id;

  insert into profile_leave_events (profile_id, event_type, actor_id)
  values (target_profile_id, 'restored', auth.uid());
end;
$$;
