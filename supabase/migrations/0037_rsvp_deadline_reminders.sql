-- Optional per-event RSVP deadline, plus a dedupe log so the rsvp-reminder
-- cron job (see below) never pushes the same reminder to the same person
-- twice for the same event.

alter table club_events add column if not exists rsvp_deadline timestamptz null;

-- event_invitees has no per-row status to piggyback a "reminded" flag onto,
-- and visibility='all' events have no per-person row at all, so a small
-- standalone log is the simplest way to track "already reminded" across
-- both cases.
create table if not exists rsvp_reminder_log (
  event_id uuid not null references club_events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (event_id, profile_id)
);

alter table rsvp_reminder_log enable row level security;
create policy "officer+ read rsvp_reminder_log" on rsvp_reminder_log for select using (is_officer_or_above());

-- Every hour, ask the rsvp-reminder function to look at events whose
-- rsvp_deadline is within the next 24 hours and push a LINE reminder to
-- anyone in the eligible pool (all members for visibility='all', invitees
-- for invite_only) who hasn't RSVP'd yet and hasn't already been reminded
-- for this event. Same pg_cron + pg_net + vault-secret pattern as
-- task-deadline-reminders (see 0032_schedule_task_deadline_reminders_cron.sql).
select cron.schedule(
  'rsvp-reminder',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/rsvp-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'broadcast_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
