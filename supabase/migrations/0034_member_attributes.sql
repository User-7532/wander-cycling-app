-- Flexible member "attribute" (tag) system, replacing the static
-- profiles.year text field over time. Members can be tagged with arbitrary
-- attribute types (e.g. "学年" grade year, "参加した旅" which trips someone
-- went on) and multiple values per type when the attribute is 'multi'.
--
-- Two attributes -- grade_year and active_status -- are 'system'-managed:
-- their values are fixed/seeded here and their assignment to people is
-- fully automated by the update-member-status-attributes edge function
-- (scheduled daily via pg_cron, see 0035_schedule_member_status_cron.sql),
-- derived purely from the new profiles.cohort_year column + today's date.
-- Nobody -- not even an admin -- can hand-edit a 'system' attribute's
-- assignments through the normal RLS paths below; only the scheduled job,
-- running as service role (which bypasses RLS), may write those. Admins
-- instead edit profiles.cohort_year and let the job recompute from it.

-- 1. Attribute type definitions.
create table member_attributes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  color text not null default '#22c55e',
  cardinality text not null check (cardinality in ('single', 'multi')),
  required boolean not null default false,
  managed_by text not null default 'manual' check (managed_by in ('manual', 'system')),
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table member_attributes enable row level security;

create policy "read member_attributes" on member_attributes
  for select using (auth.uid() is not null);
create policy "executive write member_attributes" on member_attributes
  for all using (is_executive()) with check (is_executive());

-- 2. Selectable values under an attribute type, e.g. under "参加した旅":
-- "2025年 台湾旅行", "2026年 沖縄旅行".
create table member_attribute_values (
  id uuid primary key default gen_random_uuid(),
  attribute_id uuid not null references member_attributes(id) on delete cascade,
  value text not null,
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (attribute_id, value)
);

alter table member_attribute_values enable row level security;

create policy "read member_attribute_values" on member_attribute_values
  for select using (auth.uid() is not null);

-- Any signed-in member can propose a new value (e.g. a new trip) under a
-- manual attribute, but nobody can add values under a system attribute --
-- those are fixed and seeded below.
create policy "insert manual member_attribute_values" on member_attribute_values
  for insert with check (
    auth.uid() is not null
    and exists (
      select 1 from member_attributes a
      where a.id = attribute_id and a.managed_by = 'manual'
    )
  );

create policy "update own or executive manual member_attribute_values" on member_attribute_values
  for update using (
    (created_by = auth.uid() or is_executive())
    and exists (
      select 1 from member_attributes a
      where a.id = attribute_id and a.managed_by = 'manual'
    )
  ) with check (
    (created_by = auth.uid() or is_executive())
    and exists (
      select 1 from member_attributes a
      where a.id = attribute_id and a.managed_by = 'manual'
    )
  );

create policy "delete own or executive manual member_attribute_values" on member_attribute_values
  for delete using (
    (created_by = auth.uid() or is_executive())
    and exists (
      select 1 from member_attributes a
      where a.id = attribute_id and a.managed_by = 'manual'
    )
  );

-- 3. Join table: which people have which attribute values.
create table profile_attribute_values (
  profile_id uuid not null references profiles(id) on delete cascade,
  attribute_value_id uuid not null references member_attribute_values(id) on delete cascade,
  assigned_by uuid references profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (profile_id, attribute_value_id)
);

alter table profile_attribute_values enable row level security;

-- Readable by any signed-in member (a later bulk-select UI needs to query
-- "everyone tagged X" across all profiles, not just one's own).
create policy "read profile_attribute_values" on profile_attribute_values
  for select using (auth.uid() is not null);

-- Self-tagging or executive, and only for manual attributes -- system
-- attributes are only ever written by the scheduled job via service role,
-- which bypasses RLS entirely and is unaffected by these policies.
create policy "insert manual profile_attribute_values" on profile_attribute_values
  for insert with check (
    (profile_id = auth.uid() or is_executive())
    and exists (
      select 1 from member_attribute_values v
      join member_attributes a on a.id = v.attribute_id
      where v.id = attribute_value_id and a.managed_by = 'manual'
    )
  );

create policy "delete manual profile_attribute_values" on profile_attribute_values
  for delete using (
    (profile_id = auth.uid() or is_executive())
    and exists (
      select 1 from member_attribute_values v
      join member_attributes a on a.id = v.attribute_id
      where v.id = attribute_value_id and a.managed_by = 'manual'
    )
  );

-- 4. 入部年度 (the academic year, e.g. 2024, this person joined as a 1年).
-- Manually set by an admin (later UI phase); the source of truth from which
-- grade_year and active_status are both automatically derived.
alter table profiles add column cohort_year integer;

-- 5. Seed the two system-managed attributes and their fixed value sets.
insert into member_attributes (key, label, color, cardinality, required, managed_by, sort_order)
values
  ('grade_year', '学年', '#22c55e', 'single', true, 'system', 1),
  ('active_status', '現役/OB', '#6366f1', 'single', true, 'system', 2);

insert into member_attribute_values (attribute_id, value, sort_order)
select id, v, ord
from member_attributes, lateral (
  values ('1年', 1), ('2年', 2), ('3年', 3), ('4年', 4), ('卒業', 5)
) as vals(v, ord)
where key = 'grade_year';

insert into member_attribute_values (attribute_id, value, sort_order)
select id, v, ord
from member_attributes, lateral (
  values ('現役', 1), ('OB', 2)
) as vals(v, ord)
where key = 'active_status';
