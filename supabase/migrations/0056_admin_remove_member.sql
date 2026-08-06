-- Lets an アプリ管理者 trigger the same reversible leave flow leave_club()
-- gives members for themselves (0050_member_leave_and_restore.sql), but on
-- someone else's behalf -- e.g. a member tells the club they're leaving
-- verbally/via LINE instead of using the self-service button. Deliberately
-- reuses the exact same soft-delete shape (role-clear + left_at + audit
-- event) rather than a real delete, so restore_member() already works for
-- undoing this too -- no new "undo remove" mechanism needed.
create or replace function remove_member(target_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_executive() then
    raise exception '権限がありません: この操作はアプリ管理者のみ実行できます。' using errcode = 'P0001';
  end if;

  -- Same zero-executive-lockout protection as leave_club(): if this would
  -- drop the club to zero アプリ管理者, prevent_zero_executive_lockout_profile_roles
  -- (0045) raises here and aborts the whole transaction -- left_at is never
  -- set and no event row is written.
  delete from profile_roles where profile_id = target_profile_id;

  update profiles set left_at = now() where id = target_profile_id;

  insert into profile_leave_events (profile_id, event_type, actor_id)
  values (target_profile_id, 'left', auth.uid());
end;
$$;

revoke all on function remove_member(uuid) from public;
grant execute on function remove_member(uuid) to authenticated;
