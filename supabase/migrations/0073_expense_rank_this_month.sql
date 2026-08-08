-- Ranking by all-time/average total felt low-stakes ("競争感薄くて
-- おもんない") -- switches my_expense_rank() to rank by THIS MONTH's
-- spending only, so it resets and stays competitive every month. Same
-- privacy guarantee as before: security definer internally so it can see
-- every active member's current-month total, but the query stays filtered
-- to auth.uid() before returning, so only the caller's own numbers leave it.

create or replace function my_expense_rank() returns table(my_total_jpy bigint, frugal_rank bigint, total_ranked bigint)
language sql stable security definer set search_path = public as $$
  with totals as (
    select
      p.id as profile_id,
      coalesce(
        sum(pe.amount_jpy) filter (
          where pe.entry_date >= date_trunc('month', current_date)
            and pe.entry_date < date_trunc('month', current_date) + interval '1 month'
        ),
        0
      ) as total_jpy
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
