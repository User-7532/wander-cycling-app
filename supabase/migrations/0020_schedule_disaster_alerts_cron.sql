-- Every 3 hours, ask the check-disaster-alerts function to look at upcoming
-- events' locations against JMA's current warnings and notify only on change.
select cron.schedule(
  'check-disaster-alerts',
  '0 */3 * * *',
  $$
  select net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/check-disaster-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'broadcast_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
