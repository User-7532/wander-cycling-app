-- Lets any signed-in member mark ANY task as done when reporting it via the
-- 掲示板 status board (e.g. reporting on someone else's behalf) -- narrower
-- than loosening the general "assignee or executive update task" RLS policy
-- (0010_rls_policies.sql), which would let a general member edit other
-- fields (title/assignee/etc.) on someone else's task too. This function can
-- only flip status to 'done', nothing else.
create or replace function complete_task_via_board(target_task_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update tasks set status = 'done', updated_at = now() where id = target_task_id;

  if not found then
    raise exception 'task not found';
  end if;
end;
$$;

grant execute on function complete_task_via_board(uuid) to authenticated;
