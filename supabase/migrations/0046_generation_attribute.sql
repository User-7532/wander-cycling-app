-- New system-managed member attribute: 代 (generation number). This club
-- was founded in 1966; generation = cohort_year + 2 - 1966 (e.g.
-- cohort_year 2024 -> 60代). Unlike grade_year/active_status, this never
-- changes for a given cohort_year -- it's still computed/kept in sync
-- automatically (by update-member-status-attributes) whenever cohort_year
-- is set, rather than being hand-editable, so it's still 'system'-managed.
--
-- No values are pre-seeded (unlike grade_year/active_status, which have a
-- small fixed set): the generation number grows every year, so
-- update-member-status-attributes find-or-creates the member_attribute_values
-- row for each generation string it encounters.
--
-- sort_order is set below grade_year (1) and active_status (2), and below
-- typical manual attributes too (e.g. the seeded 参加した旅 sits at 0), so
-- it surfaces first in any UI that lists attributes by sort_order.
insert into member_attributes (key, label, color, cardinality, required, managed_by, sort_order)
values
  ('generation', '代', '#ec4899', 'single', false, 'system', -1);
