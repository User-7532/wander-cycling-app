-- Lets an authenticated member trigger an immediate re-run of
-- update-member-status-attributes (see 0034/0035/0046), instead of waiting
-- for the next 00:30 JST cron tick. Needed for the name-confirmation +
-- cohort_year onboarding flow (NameConfirmDialog.jsx): once a brand-new
-- member sets their own cohort_year, the club owner wants active_status to
-- read as 現役 immediately, not up to 24h later.
--
-- This is a thin SECURITY DEFINER wrapper around the exact same
-- net.http_post + vault-webhook-secret call used by the cron job in
-- 0035_schedule_member_status_cron.sql and every broadcast trigger in this
-- project (0018, 0025, 0026, 0031, 0032, 0037, 0020) -- deliberately NOT a
-- direct client-side fetch with the webhook secret embedded in the
-- frontend bundle, since broadcast_webhook_secret also gates
-- broadcast-announcement/broadcast-status-post/broadcast-event-update/etc,
-- and shipping it to every browser would let any visitor trigger those.
-- Keeping the secret lookup server-side here, and only exposing a
-- no-argument RPC that re-runs the same idempotent, safe-to-repeat,
-- process-all-profiles job, matches how every other call site in this repo
-- already keeps this secret out of client code (grep the migrations
-- directory for 'broadcast_webhook_secret' -- it's never referenced from
-- src/).
create or replace function trigger_update_member_status_attributes()
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'broadcast_webhook_secret';

  perform net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/update-member-status-attributes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Webhook-Secret', webhook_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function trigger_update_member_status_attributes() from public, anon;
grant execute on function trigger_update_member_status_attributes() to authenticated;
