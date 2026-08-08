-- "Standing" task assignment targets: グループへ一括作成 already lets an
-- executive filter members by attribute/role and flip-select them into a
-- one-time snapshot of task rows (unchanged below). This adds a second,
-- parallel mechanism -- reusing the attribute-value/club-role "standing
-- target" idea already shipped for task_visible_to/announcement_recipients/
-- event_invitees (0064_dynamic_group_targets.sql) -- so a bulk task can
-- also be issued to "whoever has this attribute/role", including members
-- who gain that attribute/role LATER. Unlike visibility (a pure read-time
-- check), assignment needs an actual per-person task row to exist, so this
-- stores the task's template (title/description/priority/etc + its single
-- attribute-value-or-role target) and materializes a real task row for
-- every currently-matching profile immediately, then triggers on
-- profile_attribute_values/profile_roles inserts materialize a row for any
-- newly-matching profile going forward.
--
-- Deliberately limited to ONE target (an attribute value OR a club role,
-- not an AND-chain of several) per template, to keep "has this profile
-- already got a task from this template" a simple, race-free check. The
-- existing manual snapshot picker still supports full AND-chained
-- filtering; this is for the simpler "whole group, including future
-- joiners" case.

create table task_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_at timestamptz,
  visibility text not null default 'restricted' check (visibility in ('all', 'restricted', 'private')),
  task_group_id uuid, -- non-null => every task materialized from this template (and any sibling template sharing this id) stays status-synced via the existing 協働タスク trigger (0060)
  attribute_value_id uuid references member_attribute_values(id) on delete cascade,
  club_role_id smallint references club_roles(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_templates_target_check check (
    (attribute_value_id is not null and club_role_id is null) or
    (attribute_value_id is null and club_role_id is not null)
  )
);
alter table task_templates enable row level security;
create policy "executive manage task_templates" on task_templates for all using (is_executive()) with check (is_executive());

-- Snapshot of the template's "その他、閲覧できる人を追加" (task_visible_to) config,
-- copied onto every task materialized from it -- same discriminated-union
-- shape as task_visible_to itself.
create table task_template_visible_to (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references task_templates(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  attribute_value_id uuid references member_attribute_values(id) on delete cascade,
  club_role_id smallint references club_roles(id) on delete cascade,
  constraint task_template_visible_to_target_check check (
    (profile_id is not null)::int + (attribute_value_id is not null)::int + (club_role_id is not null)::int = 1
  )
);
alter table task_template_visible_to enable row level security;
create policy "executive manage task_template_visible_to" on task_template_visible_to for all using (is_executive()) with check (is_executive());

alter table tasks add column template_id uuid references task_templates(id) on delete set null;
create index tasks_template_id_idx on tasks(template_id) where template_id is not null;
-- Backstop against a profile ending up with two tasks from the same
-- template (shouldn't happen -- materialize_task_for_profile checks first
-- within the same transaction as the triggering insert -- but cheap to
-- guarantee at the DB level too).
create unique index tasks_template_assignee_uniq on tasks(template_id, assigned_to) where template_id is not null;

-- Creates the one task row + its task_visible_to rows for (template, profile),
-- unless that profile already has one from this template. Used both for the
-- initial "materialize for everyone who matches right now" pass and for
-- each later trigger firing on a newly-added attribute/role.
create or replace function materialize_task_for_profile(p_template_id uuid, p_profile_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_template task_templates%rowtype;
  v_task_id uuid;
  v_group_status text;
begin
  select * into v_template from task_templates where id = p_template_id;
  if not found then
    return null;
  end if;

  if exists (select 1 from tasks where template_id = p_template_id and assigned_to = p_profile_id) then
    return null;
  end if;

  if v_template.task_group_id is not null then
    select status into v_group_status from tasks where task_group_id = v_template.task_group_id limit 1;
  end if;

  v_task_id := gen_random_uuid();
  insert into tasks (id, title, description, assigned_to, priority, due_at, visibility, task_group_id, template_id, created_by, status)
  values (
    v_task_id, v_template.title, v_template.description, p_profile_id, v_template.priority, v_template.due_at,
    v_template.visibility, v_template.task_group_id, p_template_id, v_template.created_by, coalesce(v_group_status, 'todo')
  );

  insert into task_visible_to (task_id, profile_id, attribute_value_id, club_role_id)
  select v_task_id, profile_id, attribute_value_id, club_role_id from task_template_visible_to where template_id = p_template_id;

  return v_task_id;
end;
$$;

-- Executive-only entry point called from the client at bulk-create time:
-- creates the template, copies in its extra-viewers config, and immediately
-- materializes a task for everyone who matches the target today.
create or replace function create_task_template(
  p_title text,
  p_description text,
  p_priority text,
  p_due_at timestamptz,
  p_visibility text,
  p_task_group_id uuid,
  p_attribute_value_id uuid,
  p_club_role_id smallint,
  p_visible_to jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_template_id uuid;
  v_profile_id uuid;
begin
  if not is_executive() then
    raise exception 'not authorized';
  end if;

  insert into task_templates (title, description, priority, due_at, visibility, task_group_id, attribute_value_id, club_role_id, created_by)
  values (p_title, p_description, p_priority, p_due_at, p_visibility, p_task_group_id, p_attribute_value_id, p_club_role_id, auth.uid())
  returning id into v_template_id;

  insert into task_template_visible_to (template_id, profile_id, attribute_value_id, club_role_id)
  select v_template_id, (elem->>'profile_id')::uuid, (elem->>'attribute_value_id')::uuid, (elem->>'club_role_id')::smallint
  from jsonb_array_elements(coalesce(p_visible_to, '[]'::jsonb)) elem;

  for v_profile_id in
    select pav.profile_id from profile_attribute_values pav where p_attribute_value_id is not null and pav.attribute_value_id = p_attribute_value_id
    union
    select pr.profile_id from profile_roles pr where p_club_role_id is not null and pr.club_role_id = p_club_role_id
  loop
    perform materialize_task_for_profile(v_template_id, v_profile_id);
  end loop;

  return v_template_id;
end;
$$;
grant execute on function create_task_template(text, text, text, timestamptz, text, uuid, uuid, smallint, jsonb) to authenticated;

create or replace function task_templates_sync_new_attribute_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_template_id uuid;
begin
  for v_template_id in select id from task_templates where attribute_value_id = new.attribute_value_id loop
    perform materialize_task_for_profile(v_template_id, new.profile_id);
  end loop;
  return new;
end;
$$;
create trigger trg_task_templates_sync_new_attribute_member
  after insert on profile_attribute_values
  for each row execute function task_templates_sync_new_attribute_member();

create or replace function task_templates_sync_new_role_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_template_id uuid;
begin
  for v_template_id in select id from task_templates where club_role_id = new.club_role_id loop
    perform materialize_task_for_profile(v_template_id, new.profile_id);
  end loop;
  return new;
end;
$$;
create trigger trg_task_templates_sync_new_role_member
  after insert on profile_roles
  for each row execute function task_templates_sync_new_role_member();
