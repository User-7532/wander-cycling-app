-- Internal club slang/terms the AI secretary picks up during conversation,
-- so it can recall them later instead of claiming it "can't" know them.
create table if not exists club_glossary (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  definition text not null,
  added_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (term)
);

alter table club_glossary enable row level security;
create policy "read club_glossary" on club_glossary for select using (auth.uid() is not null);
create policy "executive write club_glossary" on club_glossary for all using (is_executive()) with check (is_executive());
