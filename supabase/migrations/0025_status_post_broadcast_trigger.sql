create or replace function notify_status_post_created() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/broadcast-status-post',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := jsonb_build_object('id', new.id)
  );
  return new;
end;
$$;

create trigger trg_notify_status_post_created
  after insert on status_posts
  for each row execute function notify_status_post_created();
