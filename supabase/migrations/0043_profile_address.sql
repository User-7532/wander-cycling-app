-- Let members optionally fill in their own contact details (club owner
-- request: メールアドレス・電話番号・住所を書きたい人は書けるように).
-- profiles.email/phone already exist and are nullable (confirmed via
-- information_schema before writing this migration) -- this just adds the
-- missing address field, kept nullable to match, since all three are
-- explicitly optional and self-editable via the existing
-- "self update own profile" RLS policy (id = auth.uid()).

alter table profiles add column if not exists address text;
