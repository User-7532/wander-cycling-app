import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// This is deliberately narrow and single-purpose: "タスク完了" status posts
// try to auto-complete ONE of the poster's own incomplete tasks. It never
// touches other members' tasks and does nothing if the match isn't clear —
// a general "AI watches every table and decides what to do" system would be
// too risky (wrong silent mutations); scoped, concrete automations like this
// one are added as specific needs come up instead.
serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const { id } = await req.json()
    const { data: post } = await supabase.from('status_posts').select('message, author_id').eq('id', id).single()
    if (!post) return new Response(JSON.stringify({ matched: false, reason: 'post not found' }))

    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('assigned_to', post.author_id)
      .neq('status', 'done')

    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ matched: false, reason: 'no open tasks' }))
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 200,
        system:
          '部員の「タスク完了」投稿の文章と、その人の未完了タスク一覧を照合し、投稿がどのタスクの完了報告かを判定してください。確信が持てる場合のみtask_idを返し、曖昧・該当なしの場合はnullを返してください。他のタスクを勝手に推測して選ばないこと。',
        messages: [
          {
            role: 'user',
            content: `投稿内容: "${post.message}"\n\n未完了タスク一覧:\n${tasks.map((t) => `- id: ${t.id}, title: ${t.title}`).join('\n')}\n\n上記のJSON形式でのみ回答してください: {"task_id": "<uuid か null>", "confidence": "high" | "low"}`,
          },
        ],
      }),
    })

    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`)
    const data = await res.json()
    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text')
    const parsed = JSON.parse(textBlock?.text?.match(/\{[\s\S]*\}/)?.[0] ?? '{}')

    if (parsed.task_id && parsed.confidence === 'high' && tasks.some((t) => t.id === parsed.task_id)) {
      await supabase.from('tasks').update({ status: 'done' }).eq('id', parsed.task_id)
      return new Response(JSON.stringify({ matched: true, task_id: parsed.task_id }))
    }

    return new Response(JSON.stringify({ matched: false, reason: 'no confident match', raw: parsed }))
  } catch (err) {
    console.error('auto-complete-task error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
