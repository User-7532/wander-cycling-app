-- Secrets themselves are never stored in a plain column: vault_secret_id points
-- at a Supabase Vault secret, decrypted only server-side by an Edge Function.
create table if not exists account_directory (
  id uuid primary key default gen_random_uuid(),
  service_name text not null,
  login_id text,
  vault_secret_id uuid,
  notes text,
  min_tier text not null default 'officer' check (min_tier in ('officer', 'executive')),
  created_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists account_directory_access_log (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references account_directory(id) on delete cascade,
  accessed_by uuid not null references profiles(id),
  accessed_at timestamptz not null default now()
);
