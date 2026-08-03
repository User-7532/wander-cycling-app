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
  {
    name: 'save_glossary_term',
    description:
      '部内で使われている独自の言葉・略語・ネタ・言い回しを新しく知ったときに、意味と一緒に記録しておく（次回以降の会話で使えるように）。雑談の中で自然に出てきた場合に使う。',
    input_schema: {
      type: 'object',
      properties: {
        term: { type: 'string', description: '言葉・フレーズ' },
        definition: { type: 'string', description: 'その意味・使われ方の説明' },
      },
      required: ['term', 'definition'],
    },
  },
]

const EXECUTIVE_TOOLS = [
  {
    name: 'create_event',
    description:
      '新しい予定（合宿・練習・イベントなど）を作成する（アプリ管理者のみ実行可能）。重要: ユーザーのメッセージに集合時間（何時集合か）が明記されていない場合は、このツールを絶対に呼び出さないこと。start_atに0:00や現在時刻などを勝手に補完して呼び出してはいけない。その場合は先に「集合時間は何時ですか？」と本人にプレーンテキストで質問し、回答が来るまでツールを実行しないこと。',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_at: {
          type: 'string',
          description:
            '集合時間（分単位の日時、必須）。"YYYY-MM-DD HH:mm"形式で指定する（例: "2026-08-10 08:00"）。ユーザーが時刻を言っていない場合、このフィールドを埋めるためにこのツールを呼び出してはいけない。',
        },
        end_at: {
          type: 'string',
          description: '終了日時、任意。"YYYY-MM-DD HH:mm"形式（例: "2026-08-11 15:00"）。',
        },
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
      required: ['title', 'start_at'],
    },
  },
  {
    name: 'create_task',
    description:
      '部員にタスクを割り当てる（アプリ管理者のみ実行可能）。締め切りは任意項目だが、ユーザーが締め切りに言及したのに具体的な日時（時刻含む）を言っていない場合は、due_atを0:00などで勝手に補完せず、先に本人に確認すること。締め切りの話が一切ない場合はdue_atを省略してよい。',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        assignee_name_query: { type: 'string', description: '担当者の名前（部分一致）' },
        due_at: {
          type: 'string',
          description:
            '締め切り日時、任意。"YYYY-MM-DD HH:mm"形式（例: "2026-08-10 23:59"）。ユーザーの依頼に締め切り時刻が含まれていない場合は、時刻を勝手に0:00などとして補完せず、本人に確認すること。',
        },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['title', 'assignee_name_query'],
    },
  },
  {
    name: 'create_announcement',
    description: 'お知らせを投稿する（アプリ管理者のみ実行可能）',
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

// The create_event/create_task tools ask the model for "YYYY-MM-DD HH:mm"
// (assumed to be JST, since that's the only timezone this club operates in)
// and we append the +09:00 offset ourselves before writing to a timestamptz
// column, rather than trusting Postgres to guess the session timezone.
function jstDateTimeToIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/)
  if (!match) return null
  return `${match[1]}T${match[2]}:00+09:00`
}

// For presenting timestamptz values back to the model/user in JST, so the
// bot doesn't accidentally read out a UTC hour as if it were local time.
function isoToJstDisplay(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return parts.replace(' ', 'T')
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
      .select('id, title, start_at, end_at, location, visibility')
      .gte('start_at', new Date().toISOString())
      .order('start_at')
      .limit(10)
    const formatted = (data ?? []).map((e) => ({ ...e, start_at: isoToJstDisplay(e.start_at), end_at: isoToJstDisplay(e.end_at) }))
    if (ctx.tier === 'executive' || ctx.tier === 'officer') return formatted
    const invited = new Set(
      (
        await supabase
          .from('event_invitees')
          .select('event_id')
          .eq('profile_id', ctx.profileId)
      ).data?.map((r) => r.event_id) ?? []
    )
    return formatted.filter((e) => e.visibility === 'all' || invited.has(e.id)).slice(0, 5)
  }

  if (name === 'get_my_tasks') {
    const { data } = await supabase
      .from('tasks')
      .select('title, status, priority, due_at')
      .eq('assigned_to', ctx.profileId)
      .neq('status', 'done')
      .order('due_at', { ascending: true, nullsFirst: false })
    return (data ?? []).map((t) => ({ ...t, due_at: isoToJstDisplay(t.due_at) }))
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

  if (name === 'save_glossary_term') {
    const { error } = await supabase
      .from('club_glossary')
      .upsert({ term: input.term, definition: input.definition, added_by: ctx.profileId }, { onConflict: 'term' })
    if (error) return { error: error.message }
    return { ok: true }
  }

  if (name === 'create_event') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（アプリ管理者のみ実行できます）' }
    const startAt = jstDateTimeToIso(input.start_at)
    if (!startAt) return { error: '集合時間（start_at）が正しい"YYYY-MM-DD HH:mm"形式ではありません。部員に集合時間を確認してください。' }
    const visibility = input.visibility === 'invite_only' ? 'invite_only' : 'all'
    const { data: event, error } = await supabase
      .from('club_events')
      .insert({
        title: input.title,
        start_at: startAt,
        end_at: jstDateTimeToIso(input.end_at),
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
    if (ctx.tier !== 'executive') return { error: '権限がありません（アプリ管理者のみ実行できます）' }
    const assignee = await findMemberByName(input.assignee_name_query as string)
    if (!assignee) return { error: '該当する部員が見つかりませんでした' }
    const { error } = await supabase.from('tasks').insert({
      title: input.title,
      assigned_to: assignee.id,
      due_at: jstDateTimeToIso(input.due_at),
      priority: input.priority || 'medium',
      created_by: ctx.profileId,
    })
    if (error) return { error: error.message }
    return { ok: true, assignee: assignee.full_name }
  }

  if (name === 'create_announcement') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（アプリ管理者のみ実行できます）' }
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
  ctx: { profileId: string; tier: string; callerName: string; callerRole: string; persona: string; glossary: { term: string; definition: string }[] },
  apiKey: string
) {
  const tools = ctx.tier === 'executive' ? [...BASE_TOOLS, ...EXECUTIVE_TOOLS] : BASE_TOOLS
  const glossaryText = ctx.glossary.length
    ? `\n\n[部内用語集 — これまでの会話で学んだ言葉]\n${ctx.glossary.map((g) => `・${g.term}: ${g.definition}`).join('\n')}`
    : ''
  const system = `${ctx.persona}\n\n[話しかけている部員の情報]\n名前: ${ctx.callerName}\n役職: ${ctx.callerRole}\n権限区分: ${ctx.tier}\n今日の日付: ${new Date().toISOString().slice(0, 10)}\nこの情報は事実として使ってよいが、部員本人に「あなたは○○さんですね」のように毎回確認する必要はない。${glossaryText}\n\n重要: ツール呼び出しが必要な用件だけでなく、雑談・しりとりなどの言葉遊び・ちょっとした相談にも普通に応じてよい。「秘書だからできない」のように用件外だからと安易に断らないこと。ただし、返信の中で事実として述べる内容（予定・タスク・部員情報など）は、ツールの実行結果に含まれるものだけにすること。実行していない操作をあたかも実行したかのように書いてはいけない。複数の依頼のうち一部しか実行できなかった場合は、実行できた分とできなかった分を正直に分けて伝えること。会話の中で部内だけで通じる言葉・ネタ・言い回しに気づいたら、save_glossary_termで記録しておくとよい。`
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
  const { data: glossaryRows } = await supabase.from('club_glossary').select('term, definition').order('created_at', { ascending: false }).limit(50)
  const glossary = glossaryRows ?? []

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
        glossary,
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
