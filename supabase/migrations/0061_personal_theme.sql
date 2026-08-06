-- Personal appearance settings, extending the existing per-user background
-- image preference (0036_profile_background.sql) with: light/dark mode
-- ("余白"のダークモード, i.e. surfaces/text -- distinct from the background
-- image/color, which is purely decorative), a button/accent color override,
-- a background "mode" (image vs. a flat color -- white/black/custom all
-- just being background_color values), and a font choice (curated list, or
-- a self-uploaded font file). All personal/self-only, same as
-- background_url already was.

alter table profiles add column if not exists theme_mode text not null default 'light' check (theme_mode in ('light', 'dark'));
alter table profiles add column if not exists theme_accent_color text; -- hex e.g. '#16a34a'; null = app default
alter table profiles add column if not exists background_mode text not null default 'image' check (background_mode in ('image', 'color'));
alter table profiles add column if not exists background_color text; -- hex; used when background_mode = 'color'
alter table profiles add column if not exists font_choice text not null default 'default';
alter table profiles add column if not exists custom_font_url text; -- storage path; used when font_choice = 'custom'

-- profile-fonts storage bucket -------------------------------------------------
-- Same private, per-user-folder-scoped pattern as profile-backgrounds.
insert into storage.buckets (id, name, public) values ('profile-fonts', 'profile-fonts', false)
on conflict (id) do nothing;

create policy "read own profile-fonts" on storage.objects for select
  using (bucket_id = 'profile-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "write own profile-fonts" on storage.objects for insert
  with check (bucket_id = 'profile-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own profile-fonts" on storage.objects for update
  using (bucket_id = 'profile-fonts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own profile-fonts" on storage.objects for delete
  using (bucket_id = 'profile-fonts' and (storage.foldername(name))[1] = auth.uid()::text);
