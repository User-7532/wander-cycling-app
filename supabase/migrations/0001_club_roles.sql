-- Lookup table for club roles and their access tier.
-- tier controls RLS: executive > officer > general/alumni.
create table if not exists club_roles (
  id smallint primary key,
  code text unique not null,
  label_ja text not null,
  tier text not null check (tier in ('executive', 'officer', 'general', 'alumni')),
  sort_order smallint not null default 0
);

insert into club_roles (id, code, label_ja, tier, sort_order) values
  (1, 'kanjicho', '幹事長', 'executive', 1),
  (2, 'fuku_kanjicho', '副幹事長', 'executive', 2),
  (3, 'kaikei', '会計', 'executive', 3),
  (4, 'tokubetsu_kaikei', '特別会計', 'executive', 4),
  (5, 'kikaku', '企画', 'officer', 5),
  (6, 'kosei', '厚生', 'officer', 6),
  (7, 'mecha', 'メカ', 'officer', 7),
  (8, 'kouhou', '広報', 'officer', 8),
  (9, 'bihin', '備品', 'officer', 9),
  (10, 'shuppan', '出版', 'officer', 10),
  (11, 'shougai', '渉外', 'officer', 11),
  (12, 'kiroku', '記録', 'officer', 12),
  (13, 'ippan_buin', '一般部員', 'general', 13),
  (14, 'ob', 'OB', 'alumni', 14)
on conflict (id) do nothing;
