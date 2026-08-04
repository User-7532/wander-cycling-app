-- Notify 三役 via LINE whenever a member leaves the club (leave_club() RPC,
-- see 0050_member_leave_and_restore.sql), same net.http_post + Vault-secret
-- pattern already used throughout this project.
create or replace function notify_yakuin_on_leave() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  if new.event_type <> 'left' then
    return new;
  end if;

  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/notify-member-left',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := jsonb_build_object('profile_id', new.profile_id)
  );
  return new;
end;
$$;

create trigger trg_notify_yakuin_on_leave
  after insert on profile_leave_events
  for each row execute function notify_yakuin_on_leave();
