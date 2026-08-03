-- Let each member set a personal background image for their own view of the
-- app (club owner request: 自分の好きな背景に設定できる). Purely a personal
-- preference — stored per-profile, never shown to other members.

alter table profiles add column if not exists background_url text;

-- profile-backgrounds storage bucket -----------------------------------------------
-- Private bucket, path convention <profile_id>/<filename>. Personal and
-- low-sensitivity, so any authenticated user reading/writing only their own
-- folder is sufficient (mirrors the event-attachments pattern in
-- 0030_datetime_precision_and_attachments.sql, but scoped per-user instead of
-- executive-only writes).

insert into storage.buckets (id, name, public) values ('profile-backgrounds', 'profile-backgrounds', false)
on conflict (id) do nothing;

create policy "read own profile-backgrounds" on storage.objects for select
  using (bucket_id = 'profile-backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "write own profile-backgrounds" on storage.objects for insert
  with check (bucket_id = 'profile-backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own profile-backgrounds" on storage.objects for update
  using (bucket_id = 'profile-backgrounds' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own profile-backgrounds" on storage.objects for delete
  using (bucket_id = 'profile-backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);
