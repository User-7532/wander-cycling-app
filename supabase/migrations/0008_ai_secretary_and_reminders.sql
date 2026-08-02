create table if not exists ai_secretary_conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  line_user_id text not null,
  started_at timestamptz not null default now()
);

create table if not exists ai_secretary_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_secretary_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text,
  tool_call jsonb,
  created_at timestamptz not null default now()
);

create table if not exists reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id),
  event_id uuid references club_events(id),
  task_id uuid references tasks(id),
  send_at timestamptz not null,
  channel text not null default 'line' check (channel in ('line')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  created_at timestamptz not null default now()
);
