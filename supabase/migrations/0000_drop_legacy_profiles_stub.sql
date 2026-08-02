-- An earlier experiment created a "profiles" table (bigint id, not linked to
-- auth.users) with a single test row. It predates real auth and is replaced
-- by the proper profiles table in the next migration; its one row (大野 雄梧 /
-- 副幹事長) is re-seeded against the real auth user in 0012_migrate_legacy_data.sql.
drop table if exists profiles;
