-- Every day at 00:30 JST (15:30 UTC), ask the
-- update-member-status-attributes function to recompute each profile's
-- grade_year (学年) and active_status (現役/OB) system attributes from
-- profiles.cohort_year + today's date. Same pg_net + pg_cron +
-- vault-webhook-secret pattern as check-disaster-alerts and
-- task-deadline-reminders (see 0020_schedule_disaster_alerts_cron.sql and
-- 0032_schedule_task_deadline_reminders_cron.sql). Running shortly after
-- JST midnight -- rather than at UTC midnight, which is JST 9am -- means
-- the April 1st grade rollover and September 1st OB flip both land on the
-- correct JST calendar day.
select cron.schedule(
  'update-member-status-attributes',
  '30 15 * * *',
  $$
  select net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/update-member-status-attributes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'broadcast_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
