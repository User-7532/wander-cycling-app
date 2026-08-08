-- Mirrors announcement_recipient_counts() (0067): counts DISTINCT resolved
-- recipients per targeted status_post rather than raw status_post_recipients
-- rows, so a standing attribute/role target that overlaps someone already
-- picked individually doesn't inflate the "特定N人" badge. Not
-- security-definer -- resolve_status_post_recipients (and the
-- status_post_recipients RLS it reads through) already limits what each
-- caller can see to their own posts (any member can author a targeted
-- post here, not just executives) or posts they're a target of, or
-- everything if they're executive.

create or replace function status_post_recipient_counts() returns table(status_post_id uuid, recipient_count bigint)
language sql stable as $$
  select sp.id, count(distinct rr.profile_id)
  from status_posts sp
  cross join lateral resolve_status_post_recipients(sp.id) as rr(profile_id)
  where sp.visibility = 'targeted'
  group by sp.id
$$;
