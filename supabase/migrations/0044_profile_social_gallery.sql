-- Optional, voluntarily-public member profile content (club owner request:
-- 自己紹介・SNS・画像を書きたい人だけ書けるように). This is the opposite of
-- the officer+-only contact fields added in 0043_profile_address.sql: bio,
-- SNS links, and gallery images are things a member WANTS other members to
-- see, so they must be readable by any signed-in member, not officer+-gated.
-- profiles.bio already exists (0002_profiles_and_line_identities.sql) with no
-- self-edit UI yet -- this migration only adds the SNS links / gallery
-- tables + storage bucket; the bio column itself is untouched.

-- 1. Freeform SNS/handle links, e.g. "Instagram" -> "@handle", "Swarm" -> "profile url".
-- No fixed platform list (club owner was explicit this should be open-ended).
create table profile_social_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  platform text not null,
  value text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table profile_social_links enable row level security;

create policy "read profile_social_links" on profile_social_links
  for select using (auth.uid() is not null);
create policy "manage own profile_social_links" on profile_social_links
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- 2. Optional gallery images (e.g. a QR code for adding the person on some
-- app, a favorite photo). Distinct from profiles.background_url, which is
-- private/self-only -- these are meant to be shown to other members.
create table profile_gallery_images (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  path text not null,
  caption text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table profile_gallery_images enable row level security;

create policy "read profile_gallery_images" on profile_gallery_images
  for select using (auth.uid() is not null);
create policy "manage own profile_gallery_images" on profile_gallery_images
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- profile-gallery storage bucket -----------------------------------------------
-- Private bucket, path convention <profile_id>/<filename>. Unlike
-- profile-backgrounds (self-read-only, 0036_profile_background.sql), this
-- content is meant to be seen by other members, so read is open to any
-- authenticated user while write stays scoped to the owning folder (mirrors
-- event-attachments' "any authenticated user reads" pattern from
-- 0030_datetime_precision_and_attachments.sql, combined with
-- profile-backgrounds' per-folder write scoping).

insert into storage.buckets (id, name, public) values ('profile-gallery', 'profile-gallery', false)
on conflict (id) do nothing;

create policy "read profile-gallery" on storage.objects for select
  using (bucket_id = 'profile-gallery' and auth.uid() is not null);
create policy "write own profile-gallery" on storage.objects for insert
  with check (bucket_id = 'profile-gallery' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own profile-gallery" on storage.objects for update
  using (bucket_id = 'profile-gallery' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-gallery' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own profile-gallery" on storage.objects for delete
  using (bucket_id = 'profile-gallery' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. profiles_directory() (0013_profiles_directory.sql) is the whitelisted,
-- security-definer view non-officer members use to see anyone else's
-- profile (regular profiles RLS only allows reading your own row or, for
-- officer+, everyone's). bio is now voluntarily-public content, so add it
-- to the whitelist -- everything else about this function is unchanged.
-- Return type is changing (new bio column), which Postgres won't let
-- `create or replace` do -- drop and recreate instead.
drop function if exists profiles_directory();
create function profiles_directory()
returns table (id uuid, full_name text, avatar_url text, year text, club_role_id smallint, bio text)
language sql stable security definer set search_path = public as $$
  select id, full_name, avatar_url, year, club_role_id, bio
  from profiles
  where auth.uid() is not null
$$;
