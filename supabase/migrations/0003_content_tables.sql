create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'notice' check (category in ('notice', 'event', 'important', 'practice', 'other')),
  pinned boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists club_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  start_date date not null,
  end_date date,
  location text,
  meeting_point text,
  category text not null default 'practice' check (category in ('gasshuku', 'practice', 'event', 'meeting', 'competition', 'other')),
  status text not null default 'scheduled' check (status in ('scheduled', 'ongoing', 'completed', 'cancelled')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references club_events(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'attending' check (status in ('attending', 'undecided', 'not_attending')),
  updated_at timestamptz not null default now(),
  unique (event_id, profile_id)
);

create table if not exists status_posts (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  category text not null default 'status' check (category in ('status', 'task_done', 'facility_reservation', 'crowding_info', 'other')),
  author_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid references profiles(id),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists emergency_info (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'procedure' check (category in ('contact', 'procedure', 'hospital', 'alert', 'other')),
  priority text not null default 'high' check (priority in ('high', 'medium', 'low')),
  contact text,
  sort_order smallint not null default 0
);

create table if not exists external_links (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  label text not null,
  url text not null,
  sort_order smallint not null default 0,
  is_active boolean not null default true
);
