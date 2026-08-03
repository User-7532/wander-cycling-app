import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Runs hourly (via pg_cron, see migration 0032) and pushes a LINE reminder to
// a task's assignee as its due_at approaches, escalating in urgency by
// priority. Each task tracks how far through its own reminder schedule it is
// via tasks.reminder_stage (0 = no reminder sent yet), so the same reminder
// is never sent twice.
//
// Schedule (time remaining before due_at at which a stage fires):
//   high:   3 days, 1 day, 3 hours  (3 stages)
//   medium: 1 day, 3 hours           (2 stages)
//   low:    3 hours                  (1 stage)
//
// On each invocation, for every eligible task we find the most advanced
// stage whose threshold has already been crossed (remaining time <=
// threshold) and, if it's further along than the task's current
// reminder_stage, send exactly one reminder for that stage and bump
// reminder_stage to it. This intentionally skips any intermediate stages
// the cron didn't catch in time (e.g. a task created with only 2 hours
// left never gets the "3 days before" or "1 day before" pings -- it just
// gets the still-relevant "3 hours before" one) rather than sending a
// backlog of stale reminders.

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Thresholds in ms, ordered from farthest-out to closest-to-due.
const STAGE_THRESHOLDS_MS: Record<string, number[]> = {
  high: [3 * DAY_MS, 1 * DAY_MS, 3 * HOUR_MS],
  medium: [1 * DAY_MS, 3 * HOUR_MS],
  low: [3 * HOUR_MS],
}

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTimeLeft(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}日${hours}時間`
  if (hours > 0) return `${hours}時間${minutes}分`
  return `${minutes}分`
}

// For a task at `currentStage` with `remainingMs` until due, find the
// highest stage index (0-based) whose threshold has been crossed, scanning
// from the closest-to-due threshold back toward the current stage. Returns
// null if no not-yet-sent stage's threshold has been crossed yet.
function nextStageToFire(priority: string, currentStage: number, remainingMs: number): number | null {
  const thresholds = STAGE_THRESHOLDS_MS[priority]
  if (!thresholds) return null
  for (let idx = thresholds.length - 1; idx >= currentStage; idx--) {
    if (remainingMs <= thresholds[idx]) return idx
  }
  return null
}

serve(async (req) => {
  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const nowIso = new Date().toISOString()
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('id, title, description, due_at, priority, assigned_to, reminder_stage, status')
      .neq('status', 'done')
      .not('due_at', 'is', null)
      .gt('due_at', nowIso)
      .lt('reminder_stage', 3) // 3 = the max possible stage count (high priority)

    if (error) {
      console.error('task-deadline-reminders query error:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    const now = Date.now()
    const results: Record<string, unknown> = {}

    for (const task of tasks ?? []) {
      const maxStage = STAGE_THRESHOLDS_MS[task.priority]?.length ?? 0
      if (task.reminder_stage >= maxStage) {
        results[task.id] = { skipped: 'all stages already sent' }
        continue
      }

      const remainingMs = new Date(task.due_at).getTime() - now
      const stageIdx = nextStageToFire(task.priority, task.reminder_stage, remainingMs)
      if (stageIdx === null) {
        results[task.id] = { skipped: 'no stage threshold crossed yet' }
        continue
      }

      const newStage = stageIdx + 1

      if (!task.assigned_to) {
        // Nothing to notify; still record the stage as handled so we don't
        // keep re-evaluating a task nobody is assigned to.
        await supabase.from('tasks').update({ reminder_stage: newStage }).eq('id', task.id)
        results[task.id] = { notified: false, reason: 'no assignee', reminder_stage: newStage }
        continue
      }

      const { data: identity } = await supabase
        .from('line_identities')
        .select('line_user_id')
        .eq('profile_id', task.assigned_to)
        .maybeSingle()

      if (!identity) {
        await supabase.from('tasks').update({ reminder_stage: newStage }).eq('id', task.id)
        results[task.id] = { notified: false, reason: 'assignee has no linked LINE id', reminder_stage: newStage }
        continue
      }

      const text = [
        `⏰ 締め切りが近づいています: ${task.title}`,
        `期限: ${formatDateTime(task.due_at)}`,
        `あと${formatTimeLeft(remainingMs)}`,
      ]
        .join('\n')
        .slice(0, 4900)

      const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
      const res = await fetch(LINE_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to: identity.line_user_id, messages: [{ type: 'text', text }] }),
      })

      if (!res.ok) {
        const errText = await res.text()
        console.error('LINE push failed:', errText)
        results[task.id] = { error: errText }
        continue
      }

      const { error: updateError } = await supabase.from('tasks').update({ reminder_stage: newStage }).eq('id', task.id)
      if (updateError) {
        console.error('task-deadline-reminders reminder_stage update error:', updateError)
        results[task.id] = { notified: 'push', reminder_stage_update_error: updateError.message }
        continue
      }

      results[task.id] = { notified: 'push', reminder_stage: newStage }
    }

    return new Response(JSON.stringify({ checked: tasks?.length ?? 0, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('task-deadline-reminders error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
