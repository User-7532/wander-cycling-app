-- The "特定N人" badge on Announcements.jsx counted raw announcement_recipients
-- rows, but a row can now be a standing attribute/role target (0064) that
-- resolves to a person already ALSO selected individually as their own
-- row -- e.g. 5 people picked individually plus a "60代" standing target
-- that today only matches one of those same 5 people shows as 6 rows even
-- though only 5 distinct people actually receive it. Add an aggregate
-- helper that counts DISTINCT resolved recipients per targeted
-- announcement instead, matching what resolve_announcement_recipients
-- already computes per-announcement.

create or replace function announcement_recipient_counts() returns table(announcement_id uuid, recipient_count bigint)
language sql stable as $$
  select a.id, count(distinct rr.profile_id)
  from announcements a
  cross join lateral resolve_announcement_recipients(a.id) as rr(profile_id)
  where a.visibility = 'targeted'
  group by a.id
$$;
