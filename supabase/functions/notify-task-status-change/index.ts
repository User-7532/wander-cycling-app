import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Fired by trg_notify_task_status_change (0060_task_status_sync_and_notify.sql)
// whenever a task's status changes -- notifies everyone who can currently
// see the task per the 0055_task_visibility.sql RLS model: the assignee,
// every 三役/アプリ管理者, and (visibility='restricted') anyone in
// task_visible_to, or (visibility='all') literally everyone with a linked
// LINE account. For a 協働タスク (task_group_id set), expands to every
// sibling task's assignee + viewers too, deduped, so 三役 who can see all N
// rows only get one message, not N.
const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

const STATUS_LABEL: Record<string, string> = { todo: '未着手', in_progress: '進行中', done: '完了' }

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const { task_id, new_status, actor_id } = await req.json()

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, title, task_group_id, assigned_to, visibility')
      .eq('id', task_id)
      .single()
    if (taskError || !task) {
      return new Response(JSON.stringify({ error: taskError?.message ?? 'task not found' }), { status: 404 })
    }

    // Every row in the group (itself included), so a shared task notifies
    // once per person even though N rows just changed together.
    const { data: groupTasks } = task.task_group_id
      ? await supabase.from('tasks').select('id, assigned_to, visibility').eq('task_group_id', task.task_group_id)
      : { data: [task] }
    const tasks = groupTasks ?? [task]

    // アプリ管理者 always see every task regardless of tier (0055/0062);
    // 三役 only see 'restricted' tier tasks, not 'private' ones -- mirror
    // that distinction here so a 'private' task's notifications don't fan
    // out to the whole 三役 group the way a 'restricted' one does.
    const { data: executiveRoles } = await supabase.from('club_roles').select('id').eq('tier', 'executive')
    const executiveProfileIds = new Set<string>()
    if (executiveRoles && executiveRoles.length > 0) {
      const { data: rows } = await supabase
        .from('profile_roles')
        .select('profile_id')
        .in(
          'club_role_id',
          executiveRoles.map((r) => r.id)
        )
      for (const r of rows ?? []) executiveProfileIds.add(r.profile_id)
    }

    const { data: yakuinRoles } = await supabase.from('club_roles').select('id').eq('is_yakuin', true)
    const yakuinProfileIds = new Set<string>()
    if (yakuinRoles && yakuinRoles.length > 0) {
      const { data: rows } = await supabase
        .from('profile_roles')
        .select('profile_id')
        .in(
          'club_role_id',
          yakuinRoles.map((r) => r.id)
        )
      for (const r of rows ?? []) yakuinProfileIds.add(r.profile_id)
    }

    const recipientIds = new Set<string>()
    for (const t of tasks) {
      if (t.assigned_to) recipientIds.add(t.assigned_to)
      for (const id of executiveProfileIds) recipientIds.add(id)

      if (t.visibility === 'all') {
        const { data: everyone } = await supabase.from('profiles').select('id').is('left_at', null)
        for (const p of everyone ?? []) recipientIds.add(p.id)
      } else {
        // resolve_task_visible_to expands both plain profile_id rows and
        // attribute/role-target rows into the current concrete profile set
        // (0064_dynamic_group_targets.sql) -- so someone who gains a
        // targeted attribute/role after this task was created is included
        // without needing task_visible_to itself to change.
        const { data: visibleTo } = await supabase.rpc('resolve_task_visible_to', { p_task_id: t.id })
        for (const profileId of visibleTo ?? []) recipientIds.add(profileId)
        if (t.visibility === 'restricted') {
          for (const id of yakuinProfileIds) recipientIds.add(id)
        }
      }
    }

    if (actor_id) recipientIds.delete(actor_id)
    if (recipientIds.size === 0) {
      return new Response(JSON.stringify({ notified: false, reason: 'no recipients' }))
    }

    const { data: identityRows } = await supabase
      .from('line_identities')
      .select('profile_id, line_user_id')
      .in('profile_id', [...recipientIds])
    const lineUserIds = (identityRows ?? []).map((r) => r.line_user_id)
    if (lineUserIds.length === 0) {
      return new Response(JSON.stringify({ notified: false, reason: 'no recipients have a linked LINE id' }))
    }

    let actorName: string | null = null
    if (actor_id) {
      const { data: actor } = await supabase.from('profiles').select('full_name').eq('id', actor_id).maybeSingle()
      actorName = actor?.full_name ?? null
    }

    const statusLabel = STATUS_LABEL[new_status] ?? new_status
    const text = [
      `📋 タスク「${task.title}」が『${statusLabel}』になりました`,
      actorName ? `更新した人: ${actorName}` : null,
    ]
      .filter((line) => line !== null)
      .join('\n')
      .slice(0, 4900)

    const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
    const res = await fetch(LINE_MULTICAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: lineUserIds, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('LINE multicast failed:', errText)
      return new Response(JSON.stringify({ error: errText }), { status: 502 })
    }

    return new Response(JSON.stringify({ notified: 'multicast', recipients: lineUserIds.length }))
  } catch (err) {
    console.error('notify-task-status-change error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }
})
