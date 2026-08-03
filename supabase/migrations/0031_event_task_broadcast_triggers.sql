-- Extend the existing "insert -> LINE push" pattern (see 0018/0025) to
-- club_events and tasks, and to updates as well as inserts, so members
-- affected by an event/task are notified both when it's created AND when
-- it's meaningfully edited (the club owner's request: 編集でも配信してほしい).
--
-- club_events: targeted delivery, same logic as check-disaster-alerts --
-- visibility='all' goes to every LINE friend (broadcast), visibility=
-- 'invite_only' goes only to the invitees' LINE ids (multicast), via the new
-- broadcast-event-update Edge Function.
--
-- tasks: single-recipient delivery to the assignee's LINE id, via the new
-- notify-task-update Edge Function.

-- club_events ---------------------------------------------------------------

create or replace function notify_club_event_created() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/broadcast-event-update',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := jsonb_build_object('id', new.id, 'action', 'created')
  );
  return new;
end;
$$;

create trigger trg_notify_club_event_created
  after insert on club_events
  for each row execute function notify_club_event_created();

-- Only fires on fields a member would actually notice/care about. `status`
-- is deliberately included (e.g. scheduled -> cancelled is exactly the kind
-- of change members need pushed to them); `updated_at` is bookkeeping and is
-- not in this list, so it alone never triggers a notification.
create or replace function notify_club_event_updated() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/broadcast-event-update',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := jsonb_build_object('id', new.id, 'action', 'updated')
  );
  return new;
end;
$$;

create trigger trg_notify_club_event_updated
  after update of title, description, start_at, end_at, location, meeting_point, link, category, status
  on club_events
  for each row execute function notify_club_event_updated();

-- tasks -----------------------------------------------------------------------

create or replace function notify_task_created() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/notify-task-update',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := jsonb_build_object('id', new.id, 'action', 'created')
  );
  return new;
end;
$$;

create trigger trg_notify_task_created
  after insert on tasks
  for each row execute function notify_task_created();

-- `status` and `reminder_stage` are deliberately excluded: status flips via
-- routine task completion (not an edit worth pushing), and reminder_stage is
-- bumped by a separate scheduled-reminder feature -- including it here would
-- cause every automated reminder tick to also fire a false "task updated"
-- push.
create or replace function notify_task_updated() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/notify-task-update',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := jsonb_build_object('id', new.id, 'action', 'updated')
  );
  return new;
end;
$$;

create trigger trg_notify_task_updated
  after update of title, description, due_at, priority
  on tasks
  for each row execute function notify_task_updated();
