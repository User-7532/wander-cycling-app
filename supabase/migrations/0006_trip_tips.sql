create table if not exists trip_tips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  region text,
  tags text[],
  author_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trip_tip_photos (
  id uuid primary key default gen_random_uuid(),
  trip_tip_id uuid not null references trip_tips(id) on delete cascade,
  storage_path text not null,
  caption text,
  sort_order smallint not null default 0
);
