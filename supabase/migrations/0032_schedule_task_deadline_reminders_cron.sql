-- Every hour, ask the task-deadline-reminders function to look at tasks
-- whose due_at is approaching and push the next escalation-stage LINE
-- reminder to the assignee. Same pg_cron + pg_net + vault-secret pattern as
-- check-disaster-alerts (see 0020_schedule_disaster_alerts_cron.sql).
select cron.schedule(
  'task-deadline-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/task-deadline-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'broadcast_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
