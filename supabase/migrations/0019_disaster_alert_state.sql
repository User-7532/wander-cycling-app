-- Tracks the last-seen JMA headline per prefecture-level office code, so the
-- disaster-alert cron job only notifies when something actually changes
-- instead of repeating the same advisory every run.
create table if not exists disaster_alert_state (
  office_code text primary key,
  office_name text not null,
  last_headline text,
  updated_at timestamptz not null default now()
);

alter table disaster_alert_state enable row level security;
create policy "executive read disaster_alert_state" on disaster_alert_state for select using (is_executive());
