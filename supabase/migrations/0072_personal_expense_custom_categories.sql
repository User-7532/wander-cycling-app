-- Drops レンタル from the built-in category set (frontend-only change, no
-- DB constraint referenced it by name) and lets each member define their
-- own additional categories that persist for reuse later. Categories are
-- now plain text on personal_expenses.category (the Japanese label itself,
-- e.g. '交通費' or a custom '自転車修理') rather than a fixed english-key
-- enum, so built-in and custom categories are handled identically by the
-- frontend. No existing rows to migrate (table shipped with this session,
-- still at 0 rows).

alter table personal_expenses drop constraint personal_expenses_category_check;

create table personal_expense_categories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  unique (profile_id, label)
);
alter table personal_expense_categories enable row level security;

create policy "self manage personal_expense_categories" on personal_expense_categories for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
