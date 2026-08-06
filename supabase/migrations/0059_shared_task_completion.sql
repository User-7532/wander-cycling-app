-- Distinguishes two kinds of multi-assignee tasks: normal ones where each
-- assignee has their own independent row/completion (existing bulk-create
-- behavior, unchanged), and "協働タスク" (shared/collaborative) ones -- e.g.
-- "花火購入" -- where the underlying job only needs doing once, so one
-- assignee completing their row should complete it for everyone else in
-- the group too. Kept as one tasks row per assignee (not a new
-- many-to-many assignee model) specifically to avoid touching the large
-- amount of existing code keyed on tasks.assigned_to (RLS, the calendar
-- feed, the LINE bot's task tools, notifications, task_visible_to) --
-- task_group_id just links sibling rows created together, and a trigger
-- propagates completion across the group.
alter table tasks add column task_group_id uuid null;
create index tasks_task_group_id_idx on tasks(task_group_id) where task_group_id is not null;

-- security definer: the member who completes their own row (allowed by the
-- existing "assignee or executive update task" policy) usually isn't the
-- assignee of the sibling rows, so the propagating update needs to bypass
-- their RLS the same way other automatic system cascades in this project do
-- (e.g. sync_primary_club_role()).
--
-- pg_trigger_depth() = 1 guards against infinite/redundant recursion: the
-- propagating UPDATE below itself fires this trigger again for each sibling
-- row it touches, but at that point pg_trigger_depth() is already 2, so
-- those nested firings skip the body and just return -- only the original,
-- top-level completion does the group-wide propagation.
create or replace function propagate_shared_task_completion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' and new.task_group_id is not null and pg_trigger_depth() = 1 then
    update tasks set status = 'done', updated_at = now()
    where task_group_id = new.task_group_id and id <> new.id and status <> 'done';
  end if;
  return new;
end;
$$;

create trigger trg_propagate_shared_task_completion
  after update of status on tasks
  for each row execute function propagate_shared_task_completion();
