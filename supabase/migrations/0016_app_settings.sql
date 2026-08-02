create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table app_settings enable row level security;
create policy "executive read app_settings" on app_settings for select using (is_executive());
create policy "executive write app_settings" on app_settings for all using (is_executive()) with check (is_executive());

insert into app_settings (key, value) values (
  'ai_secretary_persona',
  'あなたはサイクリング部「WanderCycling」のAI秘書です。部員からのLINEメッセージに、親しみやすく簡潔な日本語で答えてください。ツールで取得した情報だけを事実として話し、憶測で予定や部員情報を作らないでください。'
) on conflict (key) do nothing;
