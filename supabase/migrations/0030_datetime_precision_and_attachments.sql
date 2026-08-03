-- Move club_events/tasks from date-only fields to minute-precision timestamptz
-- fields (so events can carry a real 集合時間 / meeting time, and tasks a real
-- due time), add event attachments + external link, a per-member calendar
-- feed token, and relax category columns to free text (same rationale as
-- migration 0024 for status_posts).

-- club_events -----------------------------------------------------------------

alter table club_events rename column start_date to start_at;
alter table club_events alter column start_at type timestamptz
  using (start_at::timestamp AT TIME ZONE 'Asia/Tokyo');

alter table club_events rename column end_date to end_at;
alter table club_events alter column end_at type timestamptz
  using (end_at::timestamp AT TIME ZONE 'Asia/Tokyo');

alter table club_events add column if not exists link text;
alter table club_events add column if not exists attachment_path text;

alter table club_events drop constraint if exists club_events_category_check;

-- tasks -------------------------------------------------------------------------

alter table tasks rename column due_date to due_at;
alter table tasks alter column due_at type timestamptz
  using (due_at::timestamp AT TIME ZONE 'Asia/Tokyo');

alter table tasks add column if not exists reminder_stage smallint not null default 0;

-- announcements -------------------------------------------------------------------

alter table announcements drop constraint if exists announcements_category_check;

-- profiles ------------------------------------------------------------------------

alter table profiles add column if not exists calendar_feed_token uuid not null default gen_random_uuid() unique;

-- event-attachments storage bucket -------------------------------------------------
-- Private bucket, path convention <event_id>/<filename>. Only the tier that can
-- create/edit club_events (executive — verified against the "executive write
-- club_events" policy in 0010_rls_policies.sql, NOT officer_or_above) can
-- write; any authenticated member can read.

insert into storage.buckets (id, name, public) values ('event-attachments', 'event-attachments', false)
on conflict (id) do nothing;

create policy "read event-attachments" on storage.objects for select
  using (bucket_id = 'event-attachments' and auth.uid() is not null);
create policy "executive write event-attachments" on storage.objects for all
  using (bucket_id = 'event-attachments' and is_executive())
  with check (bucket_id = 'event-attachments' and is_executive());
