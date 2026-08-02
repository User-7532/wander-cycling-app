create table if not exists handover_documents (
  id uuid primary key default gen_random_uuid(),
  club_role_id smallint references club_roles(id),
  target_year text,
  title text not null,
  body text,
  attachment_urls text[],
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists safety_training_modules (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  content text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists safety_training_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references safety_training_modules(id) on delete cascade,
  prompt text not null,
  choices jsonb not null,
  correct_choice_id text not null,
  sort_order smallint not null default 0
);

create table if not exists safety_training_results (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references safety_training_modules(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  score numeric not null,
  passed boolean not null,
  answers jsonb,
  completed_at timestamptz not null default now()
);
