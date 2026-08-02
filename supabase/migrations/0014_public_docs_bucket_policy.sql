-- Public read access to the "public-docs" bucket (used for pages that must be
-- reachable by outside services without auth, e.g. LINE's provider privacy
-- policy / terms of use links).
create policy "public read public-docs bucket"
  on storage.objects for select
  using (bucket_id = 'public-docs');

create policy "executive write public-docs bucket"
  on storage.objects for all
  using (bucket_id = 'public-docs' and is_executive())
  with check (bucket_id = 'public-docs' and is_executive());
