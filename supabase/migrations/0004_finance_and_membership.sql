create table if not exists financial_records (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  direction text not null check (direction in ('income', 'expense')),
  category text not null,
  amount_jpy integer not null,
  description text,
  attachment_url text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists membership_fees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  period text not null,
  amount_jpy integer not null,
  paid_at date,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'waived')),
  note text,
  unique (profile_id, period)
);
