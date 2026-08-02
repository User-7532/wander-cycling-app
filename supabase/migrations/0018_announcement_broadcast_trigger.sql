-- On every new announcement, asynchronously call the broadcast-announcement
-- Edge Function via pg_net, which pushes it to all LINE friends of the club bot.
-- The shared secret (stored in Vault, not in this file) authenticates the call
-- since the function itself has verify_jwt disabled (LINE-style public webhook).
create or replace function notify_announcement_created() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  -- Project URL is not sensitive (it's the public API host), so it's fine as a literal here.
  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/broadcast-announcement',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := jsonb_build_object('id', new.id)
  );
  return new;
end;
$$;

create trigger trg_notify_announcement_created
  after insert on announcements
  for each row execute function notify_announcement_created();
