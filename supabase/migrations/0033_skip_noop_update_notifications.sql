-- `after update of <columns>` fires whenever an UPDATE statement's SET
-- clause touches those columns, even if the new value equals the old one.
-- The edit forms always submit the full record, so every save re-fired the
-- "updated" notification even when the user changed nothing. Add an explicit
-- OLD/NEW comparison so the webhook only fires on an actual value change.

create or replace function notify_club_event_updated() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  if old.title is not distinct from new.title
     and old.description is not distinct from new.description
     and old.start_at is not distinct from new.start_at
     and old.end_at is not distinct from new.end_at
     and old.location is not distinct from new.location
     and old.meeting_point is not distinct from new.meeting_point
     and old.link is not distinct from new.link
     and old.category is not distinct from new.category
     and old.status is not distinct from new.status
  then
    return new;
  end if;

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

create or replace function notify_task_updated() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  if old.title is not distinct from new.title
     and old.description is not distinct from new.description
     and old.due_at is not distinct from new.due_at
     and old.priority is not distinct from new.priority
  then
    return new;
  end if;

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
