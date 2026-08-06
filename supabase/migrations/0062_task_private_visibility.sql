-- Adds a third, narrower task visibility tier: 'private' (アプリ管理者・担当者
-- のみ) alongside the existing 'restricted' (アプリ管理者・三役・担当者, still
-- the default) and 'all'. For minor/personal tasks, the club owner didn't
-- want every status change notifying the whole 三役 group -- 'private' drops
-- the automatic 三役 visibility (and, correspondingly, the notification
-- fan-out in notify-task-status-change) while still always including
-- アプリ管理者 for oversight/lockout-consistency with every other tier.

alter table tasks drop constraint if exists tasks_visibility_check;
alter table tasks add constraint tasks_visibility_check check (visibility in ('all', 'restricted', 'private'));

drop policy if exists "read visible tasks" on tasks;
create policy "read visible tasks" on tasks for select using (
  visibility = 'all'
  or is_executive()
  or assigned_to = auth.uid()
  or exists (select 1 from task_visible_to tv where tv.task_id = id and tv.profile_id = auth.uid())
  or (visibility = 'restricted' and is_yakuin())
);

-- Consistency follow-through: a 三役 who can't see a 'private' task itself
-- shouldn't be able to see who else it was shared with, either.
drop policy if exists "self read own task visibility row" on task_visible_to;
create policy "self read own task visibility row" on task_visible_to for select using (
  profile_id = auth.uid()
  or is_executive()
  or (is_yakuin() and exists (select 1 from tasks t where t.id = task_id and t.visibility = 'restricted'))
);
