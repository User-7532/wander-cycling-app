-- A task_group_id can now grow multiple standing targets over time (an
-- executive editing a 協働タスク can add a second/third 自動更新 attribute or
-- role alongside -- or replacing -- the first one). materialize_task_for_profile
-- only checked "does this profile already have a task from THIS SAME
-- template", so a person already in the group (manually, or via a
-- DIFFERENT template on the same group) would get a second, duplicate
-- task row the moment a new template happened to also match them.
--
-- Broaden the guard: when the template belongs to a group, skip anyone who
-- already has ANY task in that group, not just one from this exact
-- template. Templates with no task_group_id (not currently reachable from
-- the UI, but not disallowed by the schema) keep the original per-template
-- check.

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

  if exists (
    select 1 from tasks
    where assigned_to = p_profile_id
      and (
        template_id = p_template_id
        or (v_template.task_group_id is not null and task_group_id = v_template.task_group_id)
      )
  ) then
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
