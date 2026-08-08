-- 掲示板 (status_posts) had no targeting at all -- every post was readable by
-- every member and broadcast to everyone (minus OB) over LINE. Adds the same
-- targeting model already used by tasks/announcements/events: default
-- visibility='all' (unchanged behavior), or 'targeted' with a
-- status_post_recipients row per target -- a specific profile, or (built in
-- from the start this time, unlike the earlier tables) an attribute value or
-- club role for live-updating membership.
--
-- Unlike announcements/events (executive-only), any member can post to this
-- board, so targeting is scoped to the post's own author rather than
-- is_executive().

alter table status_posts add column visibility text not null default 'all' check (visibility in ('all', 'targeted'));

-- author_id is denormalized from status_posts.author_id (rather than an
-- EXISTS subquery against status_posts) specifically to avoid a circular
-- RLS reference: status_posts' own read policy below needs to query THIS
-- table, so this table's policies can't turn around and query status_posts
-- -- Postgres refuses to plan that (confirmed: 42P17 infinite recursion).
create table status_post_recipients (
  id uuid primary key default gen_random_uuid(),
  status_post_id uuid not null references status_posts(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  attribute_value_id uuid references member_attribute_values(id) on delete cascade,
  club_role_id smallint references club_roles(id) on delete cascade,
  constraint status_post_recipients_target_check check (
    (profile_id is not null)::int + (attribute_value_id is not null)::int + (club_role_id is not null)::int = 1
  )
);
create unique index status_post_recipients_profile_uniq on status_post_recipients(status_post_id, profile_id) where profile_id is not null;
create unique index status_post_recipients_attr_uniq on status_post_recipients(status_post_id, attribute_value_id) where attribute_value_id is not null;
create unique index status_post_recipients_role_uniq on status_post_recipients(status_post_id, club_role_id) where club_role_id is not null;
alter table status_post_recipients enable row level security;

create policy "self read own status_post_recipient row" on status_post_recipients for select using (
  member_matches_target(auth.uid(), profile_id, attribute_value_id, club_role_id)
  or is_executive()
  or author_id = auth.uid()
);
create policy "author write own status_post_recipients" on status_post_recipients for insert with check (author_id = auth.uid());
create policy "author delete own status_post_recipients" on status_post_recipients for delete using (author_id = auth.uid());
create policy "executive write status_post_recipients" on status_post_recipients for insert with check (is_executive());
create policy "executive delete status_post_recipients" on status_post_recipients for delete using (is_executive());

drop policy if exists "read status_posts" on status_posts;
create policy "read status_posts" on status_posts for select using (
  visibility = 'all'
  or author_id = auth.uid()
  or is_executive()
  or exists (
    select 1 from status_post_recipients spr
    where spr.status_post_id = status_posts.id and member_matches_target(auth.uid(), spr.profile_id, spr.attribute_value_id, spr.club_role_id)
  )
);

create or replace function resolve_status_post_recipients(p_status_post_id uuid) returns setof uuid
language sql stable as $$
  select profile_id from status_post_recipients where status_post_id = p_status_post_id and profile_id is not null
  union
  select pav.profile_id from status_post_recipients spr join profile_attribute_values pav on pav.attribute_value_id = spr.attribute_value_id where spr.status_post_id = p_status_post_id
  union
  select pr.profile_id from status_post_recipients spr join profile_roles pr on pr.club_role_id = spr.club_role_id where spr.status_post_id = p_status_post_id
$$;
