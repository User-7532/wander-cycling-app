import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOOL_ROUNDS = 4
const DEFAULT_PERSONA =
  'あなたはサイクリング部「WanderCycling」のAI秘書です。部員からのLINEメッセージに、親しみやすく簡潔な日本語で答えてください。ツールで取得した情報だけを事実として話し、憶測で予定や部員情報を作らないでください。'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// --- LINE signature verification -------------------------------------------------

async function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string) {
  if (!signature) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  return expected === signature
}

async function replyToLine(replyToken: string, text: string, accessToken: string) {
  await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  })
}

// --- Tools available to the assistant --------------------------------------------
// Read-only tools are offered to every member. Tools that create/change club-wide
// content are only included in the request when the caller's tier allows it, AND
// re-checked inside executeTool before running — never trust the model's say-so.

const BASE_TOOLS = [
  {
    name: 'get_upcoming_events',
    description: '直近の部活の予定（合宿・練習・イベントなど、自分が見られる範囲のもの）を取得する',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_tasks',
    description: '自分に割り当てられている未完了のタスク一覧を取得する',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_announcements',
    description: '直近のお知らせを新しい順に取得する',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'rsvp_event',
    description: '予定への参加ステータスを登録・更新する',
    input_schema: {
      type: 'object',
      properties: {
        event_title_query: { type: 'string', description: '予定のタイトル（部分一致で検索）' },
        status: { type: 'string', enum: ['attending', 'undecided', 'not_attending'] },
      },
      required: ['event_title_query', 'status'],
    },
  },
  {
    name: 'update_task_status',
    description: '自分のタスクのステータスを更新する（完了にする、着手するなど）',
    input_schema: {
      type: 'object',
      properties: {
        task_title_query: { type: 'string', description: 'タスクのタイトル（部分一致で検索）' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
      },
      required: ['task_title_query', 'status'],
    },
  },
  {
    name: 'post_status',
    description: '掲示板に状況報告を投稿する（例: 施設予約完了、混雑状況など）',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
]

const EXECUTIVE_TOOLS = [
  {
    name: 'create_event',
    description: '新しい予定（合宿・練習・イベントなど）を作成する（執行部のみ実行可能）',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_date: { type: 'string', description: 'YYYY-MM-DD形式' },
        end_date: { type: 'string', description: 'YYYY-MM-DD形式、任意' },
        location: { type: 'string' },
        category: { type: 'string', enum: ['gasshuku', 'practice', 'event', 'meeting', 'competition', 'other'] },
        visibility: {
          type: 'string',
          enum: ['all', 'invite_only'],
          description: "'all'は全部員に表示、'invite_only'は指定したメンバーだけに表示（有志企画など）",
        },
        invitee_name_queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'visibilityがinvite_onlyのとき、参加できるメンバーの名前（部分一致）のリスト',
        },
      },
      required: ['title', 'start_date'],
    },
  },
  {
    name: 'create_task',
    description: '部員にタスクを割り当てる（執行部のみ実行可能）',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        assignee_name_query: { type: 'string', description: '担当者の名前（部分一致）' },
        due_date: { type: 'string', description: 'YYYY-MM-DD形式、任意' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['title', 'assignee_name_query'],
    },
  },
  {
    name: 'create_announcement',
    description: 'お知らせを投稿する（執行部のみ実行可能）',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['title', 'body'],
    },
  },
]

// Full-width and half-width spaces in Japanese names (e.g. "大野 雄梧" vs
// "大野雄梧") shouldn't matter for a fuzzy lookup, so normalize both sides
// before matching instead of relying on a plain SQL ilike.
function normalizeName(s: string) {
  return s.replace(/[\s　]+/g, '').toLowerCase()
}

async function findMemberByName(query: string) {
  const { data } = await supabase.from('profiles').select('id, full_name')
  const normQuery = normalizeName(query)
  return (data ?? []).find((p) => normalizeName(p.full_name).includes(normQuery)) ?? null
}

async function executeTool(name: string, input: Record<string, unknown>, ctx: { profileId: string; tier: string }) {
  if (name === 'get_upcoming_events') {
    // profileId acts here via RLS-equivalent filtering done manually, since the
    // service-role client bypasses RLS: mirror the same visibility rule by hand.
    const { data } = await supabase
      .from('club_events')
      .select('id, title, start_date, end_date, location, visibility')
      .gte('start_date', new Date().toISOString().slice(0, 10))
      .order('start_date')
      .limit(10)
    if (ctx.tier === 'executive' || ctx.tier === 'officer') return data ?? []
    const invited = new Set(
      (
        await supabase
          .from('event_invitees')
          .select('event_id')
          .eq('profile_id', ctx.profileId)
      ).data?.map((r) => r.event_id) ?? []
    )
    return (data ?? []).filter((e) => e.visibility === 'all' || invited.has(e.id)).slice(0, 5)
  }

  if (name === 'get_my_tasks') {
    const { data } = await supabase
      .from('tasks')
      .select('title, status, priority, due_date')
      .eq('assigned_to', ctx.profileId)
      .neq('status', 'done')
      .order('due_date', { ascending: true, nullsFirst: false })
    return data ?? []
  }

  if (name === 'get_announcements') {
    const { data } = await supabase
      .from('announcements')
      .select('title, body, category, pinned, created_at')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5)
    return data ?? []
  }

  if (name === 'rsvp_event') {
    const { data: event } = await supabase
      .from('club_events')
      .select('id, title')
      .ilike('title', `%${input.event_title_query}%`)
      .limit(1)
      .maybeSingle()
    if (!event) return { error: '該当する予定が見つかりませんでした' }
    const { error } = await supabase
      .from('event_registrations')
      .upsert({ event_id: event.id, profile_id: ctx.profileId, status: input.status }, { onConflict: 'event_id,profile_id' })
    if (error) return { error: error.message }
    return { ok: true, event_title: event.title }
  }

  if (name === 'update_task_status') {
    let query = supabase.from('tasks').select('id, title, assigned_to').ilike('title', `%${input.task_title_query}%`)
    if (ctx.tier !== 'executive') query = query.eq('assigned_to', ctx.profileId)
    const { data: task } = await query.limit(1).maybeSingle()
    if (!task) return { error: '該当するタスクが見つかりませんでした（自分に割り当てられたタスクのみ操作できます）' }
    const { error } = await supabase.from('tasks').update({ status: input.status }).eq('id', task.id)
    if (error) return { error: error.message }
    return { ok: true, task_title: task.title }
  }

  if (name === 'post_status') {
    const { error } = await supabase.from('status_posts').insert({ message: input.message, author_id: ctx.profileId })
    if (error) return { error: error.message }
    return { ok: true }
  }

  if (name === 'create_event') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（執行部のみ実行できます）' }
    const visibility = input.visibility === 'invite_only' ? 'invite_only' : 'all'
    const { data: event, error } = await supabase
      .from('club_events')
      .insert({
        title: input.title,
        start_date: input.start_date,
        end_date: input.end_date || null,
        location: input.location || null,
        category: input.category || 'practice',
        visibility,
        created_by: ctx.profileId,
      })
      .select('id, title')
      .single()
    if (error) return { error: error.message }

    if (visibility === 'invite_only' && Array.isArray(input.invitee_name_queries)) {
      const invitees: string[] = []
      for (const q of input.invitee_name_queries as string[]) {
        const member = await findMemberByName(q)
        if (member) {
          await supabase.from('event_invitees').insert({ event_id: event.id, profile_id: member.id })
          invitees.push(member.full_name)
        }
      }
      return { ok: true, title: event.title, visibility, invitees }
    }
    return { ok: true, title: event.title, visibility }
  }

  if (name === 'create_task') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（執行部のみ実行できます）' }
    const assignee = await findMemberByName(input.assignee_name_query as string)
    if (!assignee) return { error: '該当する部員が見つかりませんでした' }
    const { error } = await supabase.from('tasks').insert({
      title: input.title,
      assigned_to: assignee.id,
      due_date: input.due_date || null,
      priority: input.priority || 'medium',
      created_by: ctx.profileId,
    })
    if (error) return { error: error.message }
    return { ok: true, assignee: assignee.full_name }
  }

  if (name === 'create_announcement') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（執行部のみ実行できます）' }
    const { error } = await supabase.from('announcements').insert({ title: input.title, body: input.body, created_by: ctx.profileId })
    if (error) return { error: error.message }
    return { ok: true }
  }

  return { error: `不明なツール: ${name}` }
}

// --- Anthropic tool-calling loop --------------------------------------------------

async function callClaude(system: string, messages: unknown[], tools: unknown[], apiKey: string) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1024, system, messages, tools }),
  })
  if (!res.ok) {
    throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function runAssistant(
  userText: string,
  history: { role: string; content: unknown }[],
  ctx: { profileId: string; tier: string; callerName: string; callerRole: string; persona: string },
  apiKey: string
) {
  const tools = ctx.tier === 'executive' ? [...BASE_TOOLS, ...EXECUTIVE_TOOLS] : BASE_TOOLS
  const system = `${ctx.persona}\n\n[話しかけている部員の情報]\n名前: ${ctx.callerName}\n役職: ${ctx.callerRole}\n権限区分: ${ctx.tier}\n今日の日付: ${new Date().toISOString().slice(0, 10)}\nこの情報は事実として使ってよいが、部員本人に「あなたは○○さんですね」のように毎回確認する必要はない。\n\n重要: 返信には、ツールの実行結果に含まれる内容だけを書いてください。実行していない操作（呼び出していないツール）の結果を、あたかも実行したかのように書いてはいけません。複数の依頼のうち一部しか実行できなかった場合は、実行できた分とできなかった分を正直に分けて伝えてください。`
  const messages = [...history, { role: 'user', content: userText }]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(system, messages, tools, apiKey)
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') {
      const textBlock = response.content.find((b: { type: string }) => b.type === 'text')
      return { finalText: textBlock?.text ?? '(応答なし)', messages }
    }

    const toolResults = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await executeTool(block.name, block.input, ctx)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  return { finalText: 'すみません、うまく処理できませんでした。もう一度試してください。', messages }
}

// --- Webhook entrypoint ------------------------------------------------------------

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const rawBody = await req.text()
  const signature = req.headers.get('x-line-signature')
  const channelSecret = Deno.env.get('LINE_BOT_CHANNEL_SECRET')!
  const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!

  if (!(await verifyLineSignature(rawBody, signature, channelSecret))) {
    return new Response('invalid signature', { status: 401 })
  }

  const body = JSON.parse(rawBody)

  const { data: personaSetting } = await supabase.from('app_settings').select('value').eq('key', 'ai_secretary_persona').maybeSingle()
  const persona = personaSetting?.value || DEFAULT_PERSONA

  for (const event of body.events ?? []) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue

    try {
      const lineUserId = event.source.userId
      const { data: identity } = await supabase
        .from('line_identities')
        .select('profile_id')
        .eq('line_user_id', lineUserId)
        .maybeSingle()

      if (!identity) {
        await replyToLine(event.replyToken, 'まだ連携されていないようです。一度アプリにLINEでログインしてから、もう一度話しかけてください。', accessToken)
        continue
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, club_roles(label_ja, tier)')
        .eq('id', identity.profile_id)
        .single()

      const ctx = {
        profileId: profile.id,
        tier: profile.club_roles?.tier ?? 'general',
        callerName: profile.full_name,
        callerRole: profile.club_roles?.label_ja ?? '一般部員',
        persona,
      }

      let { data: conversation } = await supabase
        .from('ai_secretary_conversations')
        .select('id')
        .eq('line_user_id', lineUserId)
        .maybeSingle()

      if (!conversation) {
        const { data: created } = await supabase
          .from('ai_secretary_conversations')
          .insert({ profile_id: ctx.profileId, line_user_id: lineUserId })
          .select('id')
          .single()
        conversation = created
      }

      const { data: recentMessages } = await supabase
        .from('ai_secretary_messages')
        .select('role, content')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(10)

      const history = (recentMessages ?? [])
        .reverse()
        .filter((m) => m.role !== 'tool')
        .map((m) => ({ role: m.role, content: m.content }))

      const { finalText } = await runAssistant(event.message.text, history, ctx, anthropicKey)

      await supabase.from('ai_secretary_messages').insert([
        { conversation_id: conversation.id, role: 'user', content: event.message.text },
        { conversation_id: conversation.id, role: 'assistant', content: finalText },
      ])

      await replyToLine(event.replyToken, finalText, accessToken)
    } catch (err) {
      console.error('line-bot error:', err)
      await replyToLine(event.replyToken, 'すみません、エラーが発生しました。しばらくしてからもう一度お試しください。', accessToken).catch(() => {})
    }
  }

  return new Response('ok')
})
