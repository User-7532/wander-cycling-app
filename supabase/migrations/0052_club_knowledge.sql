-- Freeform knowledge base the LINE bot (line-bot) writes to directly from
-- conversation, without a human review gate (club is too casual for that
-- workflow to stick). Deliberately topic/place/event-scoped, not
-- person-scoped, so there is no OB (graduated-member) personal data to
-- retain or purge here.
create table club_knowledge (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  topic text not null unique,
  content text not null,
  source text,
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index club_knowledge_category_idx on club_knowledge(category);

alter table club_knowledge enable row level security;

create policy "club_knowledge_select_authenticated" on club_knowledge
  for select to authenticated using (true);

create policy "club_knowledge_write_executive" on club_knowledge
  for all to authenticated using (is_executive()) with check (is_executive());
