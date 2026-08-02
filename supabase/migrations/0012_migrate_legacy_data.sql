-- Seed the real profile for the first (and so far only) LINE-authenticated
-- user, carrying over the name/role from the old stub profiles row.
insert into profiles (id, full_name, club_role_id)
values ('3647076c-f2ca-4e85-812d-8e7b0e239864', '大野 雄梧', 2) -- 副幹事長
on conflict (id) do update set full_name = excluded.full_name, club_role_id = excluded.club_role_id;

insert into line_identities (line_user_id, profile_id, display_name, picture_url)
values (
  'U618bbdf9e0e0bf58a23f482835e0284f',
  '3647076c-f2ca-4e85-812d-8e7b0e239864',
  '大野 雄梧',
  'https://profile.line-scdn.net/0hpSIy1YZbL3xkADGIXTpRQhRQLBZHcXZuS2MwEwMFeBkNYmksT2czHFQJJhwNYm0iQWcwSAYIdRlGTzF4SjslZxlJGg4hSR1QCxEQbwRiNBkacWk2ICMCalRVDg1dSA0qGBQ-RTAHcRg8RG0vKDsCQiJ_NAcJdGhtF1dDKmEyQf8LAlgpSWZhH1gHd0rc'
)
on conflict (line_user_id) do nothing;

-- Migrate the old ad-hoc `schedules` table into club_events, then retire it.
insert into club_events (title, start_date, end_date, location, created_by)
select title, start_date, coalesce(end_date, start_date), place, '3647076c-f2ca-4e85-812d-8e7b0e239864'
from schedules
where not exists (select 1 from club_events ce where ce.title = schedules.title and ce.start_date = schedules.start_date);

drop table if exists schedules;
