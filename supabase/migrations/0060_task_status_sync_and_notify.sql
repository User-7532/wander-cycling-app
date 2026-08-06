-- 1. Broaden shared-task sync from "completion only" to "always keep the
-- whole group's status in lock-step" (todo/in_progress/done), per explicit
-- follow-up request. Replaces propagate_shared_task_completion
-- (0059_shared_task_completion.sql) with a status-symmetric version under a
-- clearer name; same pg_trigger_depth()=1 recursion guard and SECURITY
-- DEFINER rationale as before.
drop trigger if exists trg_propagate_shared_task_completion on tasks;
drop function if exists propagate_shared_task_completion();

create or replace function propagate_shared_task_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and new.task_group_id is not null and pg_trigger_depth() = 1 then
    update tasks set status = new.status, updated_at = now()
    where task_group_id = new.task_group_id and id <> new.id and status is distinct from new.status;
  end if;
  return new;
end;
$$;

create trigger trg_propagate_shared_task_status
  after update of status on tasks
  for each row execute function propagate_shared_task_status();

-- 2. Notify everyone who can see a task (per the 0055_task_visibility.sql
-- RLS model: assignee, 三役/アプリ管理者, and -- for 'restricted' tasks --
-- anyone in task_visible_to, or literally everyone for visibility='all')
-- whenever its status changes, via the new notify-task-status-change Edge
-- Function. pg_trigger_depth()=1 means this fires exactly once per genuine
-- status-change action even for a shared task group -- the propagating
-- UPDATE above touches sibling rows at depth 2, where this guard is false,
-- so the Edge Function (not this trigger) is responsible for expanding to
-- the whole group's viewers when task_group_id is set.
create or replace function notify_task_status_change() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  if new.status is distinct from old.status and pg_trigger_depth() = 1 then
    select decrypted_secret into webhook_secret
    from vault.decrypted_secrets
    where name = 'broadcast_webhook_secret';

    perform net.http_post(
      url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/notify-task-status-change',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
      body := jsonb_build_object('task_id', new.id, 'new_status', new.status, 'actor_id', auth.uid())
    );
  end if;
  return new;
end;
$$;

create trigger trg_notify_task_status_change
  after update of status on tasks
  for each row execute function notify_task_status_change();
