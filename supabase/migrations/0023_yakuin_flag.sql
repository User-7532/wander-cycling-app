-- "役員" (yakuin) is a real club title (President/VP/Treasurer), distinct
-- from the app's internal permission tier (which we display as "アプリ管理者"
-- rather than the earlier, confusing "執行部"). 特別会計 keeps admin
-- permissions (tier='executive') but is not a 役員.
alter table club_roles add column if not exists is_yakuin boolean not null default false;

update club_roles set is_yakuin = true where code in ('kanjicho', 'fuku_kanjicho', 'kaikei');
