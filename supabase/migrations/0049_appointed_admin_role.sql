-- Convenience role so an executive can grant アプリ管理者 permissions to anyone
-- (via 兼任 in profile_roles) without them needing to hold one of the 4
-- fixed positions that carry executive tier by default (幹事長/副幹事長/会計/
-- 特別会計). is_yakuin stays false since this isn't one of the 三役.
insert into club_roles (code, label_ja, tier, is_yakuin)
values ('appointed_admin', 'アプリ管理者（指名）', 'executive', false)
on conflict (code) do nothing;
