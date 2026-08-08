-- Personal 家計簿 (kakeibo): each member's own private log of what THEY'VE
-- personally spent because of the club (travel, gear, food on trips,
-- etc.) -- distinct from Finance.jsx's financial_records, which is the
-- club's own income/expense book. Strictly self-only: no is_executive()
-- or is_yakuin() read override at all, since the whole point is these are
-- private numbers ("個人情報だから具体値は出さない").

create table personal_expenses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  entry_date date not null default current_date,
  category text not null check (category in ('transport', 'lodging', 'food', 'gear', 'rental', 'membership', 'other')),
  amount_jpy integer not null check (amount_jpy >= 0),
  description text,
  created_at timestamptz not null default now()
);
create index personal_expenses_profile_id_idx on personal_expenses(profile_id);
alter table personal_expenses enable row level security;

create policy "self manage personal_expenses" on personal_expenses for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Powers the "シャバさ" (frugality) ranking without ever exposing anyone
-- else's amount or identity: security definer so it CAN see every active
-- member's total internally, but the query itself is filtered down to
-- `where profile_id = auth.uid()` before returning, so only the caller's
-- own total/rank/field-size ever leaves the function. rank 1 = spent the
-- least (most シャバい). Scoped to currently active members (left_at is
-- null) so ranking against long-graduated members doesn't feel odd;
-- members with zero logged expenses still rank (coalesce to 0), since
-- "haven't spent anything yet" is exactly what this ranking celebrates.
create or replace function my_expense_rank() returns table(my_total_jpy bigint, frugal_rank bigint, total_ranked bigint)
language sql stable security definer set search_path = public as $$
  with totals as (
    select p.id as profile_id, coalesce(sum(pe.amount_jpy), 0) as total_jpy
    from profiles p
    left join personal_expenses pe on pe.profile_id = p.id
    where p.left_at is null
    group by p.id
  ),
  ranked as (
    select profile_id, total_jpy, rank() over (order by total_jpy asc) as frugal_rank, count(*) over () as total_ranked
    from totals
  )
  select total_jpy, frugal_rank, total_ranked from ranked where profile_id = auth.uid()
$$;
grant execute on function my_expense_rank() to authenticated;
