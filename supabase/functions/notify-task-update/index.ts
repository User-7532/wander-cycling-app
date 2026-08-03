import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Handles both "created" and "updated" tasks notifications, sent only to the
// assignee. Single recipient, so LINE's push endpoint (one `to`) is used
// rather than multicast (many `to`).
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' }

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const { id, action } = await req.json()
    const isUpdate = action === 'updated'

    const { data: task, error } = await supabase
      .from('tasks')
      .select('id, title, description, due_at, priority, assigned_to')
      .eq('id', id)
      .single()
    if (error || !task) {
      return new Response(JSON.stringify({ error: error?.message ?? 'task not found' }), { status: 404 })
    }

    if (!task.assigned_to) {
      return new Response(JSON.stringify({ notified: false, reason: 'no assignee' }))
    }

    const { data: identity } = await supabase
      .from('line_identities')
      .select('line_user_id')
      .eq('profile_id', task.assigned_to)
      .maybeSingle()
    if (!identity) {
      return new Response(JSON.stringify({ notified: false, reason: 'assignee has no linked LINE id' }))
    }

    const header = isUpdate ? '🔄 タスクが更新されました' : '🆕 新しいタスクが割り当てられました'
    const lines = [header, '', task.title]
    if (task.due_at) lines.push(`期限: ${formatDateTime(task.due_at)}`)
    if (task.priority) lines.push(`優先度: ${PRIORITY_LABEL[task.priority] ?? task.priority}`)
    if (task.description) lines.push('', task.description)
    const text = lines.join('\n').slice(0, 4900)

    const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
    const res = await fetch(LINE_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: identity.line_user_id, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('LINE push failed:', errText)
      return new Response(JSON.stringify({ error: errText }), { status: 502 })
    }

    return new Response(JSON.stringify({ notified: 'push' }))
  } catch (err) {
    console.error('notify-task-update error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
