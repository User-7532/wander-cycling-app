-- Track whether a member has confirmed their profiles.full_name (auto-populated
-- from their LINE display name on first login, which is frequently a nickname
-- rather than their real/club-roster name) is correct. Defaults to false so
-- existing members are also prompted once, not just brand-new signups.
alter table public.profiles
  add column name_confirmed boolean not null default false;
