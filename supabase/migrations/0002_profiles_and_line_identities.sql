-- One profile per Supabase auth user. club_role_id defaults to 一般部員 (general).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  student_id text,
  club_role_id smallint not null references club_roles(id) default 13,
  year text check (year in ('b1', 'b2', 'b3', 'b4', 'grad', 'ob')),
  phone text,
  emergency_contact text,
  status text not null default 'active' check (status in ('active', 'leave', 'ob')),
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Maps a LINE account's stable user id to a Supabase profile (one-to-one).
create table if not exists line_identities (
  line_user_id text primary key,
  profile_id uuid not null unique references profiles(id) on delete cascade,
  display_name text,
  picture_url text,
  linked_at timestamptz not null default now()
);
