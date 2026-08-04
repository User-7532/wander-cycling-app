import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
// Same push endpoint/shape as notify-task-update and task-deadline-reminders
// (single recipient per call, so the push — not multicast — endpoint).
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_MODEL = 'claude-sonnet-5'
const MAX_TOOL_ROUNDS = 8

// Anthropic-hosted server tools — Claude decides when to call these, and the
// API executes them itself (no round-trip through executeTool). Basic
// (non-dynamic-filtering) variants: dynamic filtering requires Opus/Sonnet
// 4.6+, and Haiku 4.5 doesn't need it here since these are one-off lookups,
// not heavy multi-page research.
const SERVER_TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
  { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 },
]
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

// Push (as opposed to reply) — used when the bot initiates a message outside
// of a reply-token window, e.g. a remind_incomplete_task_holders tool call.
// Returns whether the push actually succeeded so callers can report honestly.
async function pushToLine(lineUserId: string, text: string, accessToken: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  })
  if (!res.ok) {
    const errText = await res.text()
    console.error('LINE push failed:', errText)
    return { ok: false, error: errText }
  }
  return { ok: true }
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
    description:
      'タスクのステータスを更新する（完了にする、着手するなど）。自分のタスクは自由に変更できる。他人のタスクは「完了」にすることだけできる（掲示板での完了報告と同じ扱い）。task_title_queryが複数のタスクに一致した場合はambiguous:trueと候補一覧が返るので、実行せずに誰の・いつまでのタスクか本人に確認し、assignee_name_queryなどで絞り込んでから再度呼び出すこと。憶測でどれか1つを選んで実行してはいけない。',
    input_schema: {
      type: 'object',
      properties: {
        task_title_query: { type: 'string', description: 'タスクのタイトル（部分一致で検索）' },
        assignee_name_query: {
          type: 'string',
          description: '担当者の名前（部分一致）、任意。同じタイトルのタスクが複数あるときの絞り込みに使う。',
        },
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
  {
    name: 'search_club_knowledge',
    description:
      '部の知識ベース（過去の旅程・場所の情報・予算感・文化・ノウハウなど）をキーワードで検索する。旅程相談や「前に行った時どうだった？」のような質問に答える前に、まずこれで関連情報がないか確認するとよい。',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '検索キーワード（例: "長万部", "国境越え", "テント泊"）' } },
      required: ['query'],
    },
  },
  {
    name: 'save_club_knowledge',
    description:
      '部にとって今後役立ちそうな知識（場所の情報、旅程のコツ、予算感、過去のトラブルとその対処、部の文化・慣習など）を新しく知ったときに知識ベースに記録する。承認や確認は不要、気づいたら自分の判断で保存してよい。同じtopicで再度保存すると内容が上書きされる。重要: 特定個人についての私的な情報（誰が何をした、個人の連絡先や体調など）は保存しないこと。場所・イベント・ノウハウなど部として再利用できる知識に限る。',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '例: "旅程", "場所", "予算", "文化", "安全", "その他"' },
        topic: { type: 'string', description: '短い見出し（例: "長万部の温泉事情"）。既存と同じ見出しなら上書き更新される。' },
        content: { type: 'string', description: '知識の内容。具体的であるほどよい。' },
        source: { type: 'string', description: '情報の出所（例: "LINE会話", "Web検索", "引き継ぎ資料"）、任意。' },
      },
      required: ['category', 'topic', 'content'],
    },
  },
  {
    name: 'list_handover_resources',
    description:
      '資料ページに登録されている引き継ぎ資料・旅行Tipsなどの外部リンク一覧を取得する。旅程の物理的な段取り（国境越え、宿泊、装備など）を考えるとき、過去の引き継ぎ資料に載っていそうであれば、まずこれでリンクを確認し、必要なら中身をweb_fetchで読みに行くとよい。',
    input_schema: { type: 'object', properties: {} },
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
    name: 'update_event',
    description:
      '既存の予定の内容（タイトル・集合時間・終了日時・場所・カテゴリ・公開範囲）を編集する（アプリ管理者のみ実行可能）。変更したい項目だけをnew_で始まるフィールドに入れる。event_title_queryが複数の予定に一致した場合はambiguous:trueと候補一覧が返るので、実行せずにどの予定か本人に確認してから再度呼び出すこと。新しい集合時間にユーザーが時刻を言っていない場合、new_start_atを0:00などで勝手に補完せず、先に本人に確認すること。',
    input_schema: {
      type: 'object',
      properties: {
        event_title_query: { type: 'string', description: '編集したい予定の現在のタイトル（部分一致で検索）' },
        new_title: { type: 'string', description: '新しいタイトル。変更しない場合は省略。' },
        new_start_at: {
          type: 'string',
          description: '新しい集合時間。"YYYY-MM-DD HH:mm"形式（例: "2026-08-10 08:00"）。変更しない場合は省略。',
        },
        new_end_at: {
          type: 'string',
          description: '新しい終了日時。"YYYY-MM-DD HH:mm"形式（例: "2026-08-11 15:00"）。変更しない場合は省略。',
        },
        new_location: { type: 'string', description: '変更しない場合は省略。' },
        new_category: { type: 'string', enum: ['gasshuku', 'practice', 'event', 'meeting', 'competition', 'other'], description: '変更しない場合は省略。' },
        new_visibility: { type: 'string', enum: ['all', 'invite_only'], description: '変更しない場合は省略。' },
      },
      required: ['event_title_query'],
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
    name: 'update_task',
    description:
      '既存タスクの内容（タイトル・担当者・締め切り・優先度）を編集する（アプリ管理者のみ実行可能）。変更したい項目だけをnew_で始まるフィールドに入れる。task_title_queryが複数のタスクに一致した場合はambiguous:trueと候補一覧が返るので、実行せずにどのタスクか本人に確認し、assignee_name_queryなどで絞り込んでから再度呼び出すこと。新しい締め切りにユーザーが時刻を言っていない場合、new_due_atを0:00などで勝手に補完せず、先に本人に確認すること。',
    input_schema: {
      type: 'object',
      properties: {
        task_title_query: { type: 'string', description: '編集したいタスクの現在のタイトル（部分一致で検索）' },
        assignee_name_query: { type: 'string', description: '絞り込み用、現在の担当者名（部分一致）、任意' },
        new_title: { type: 'string', description: '新しいタイトル。変更しない場合は省略。' },
        new_assignee_name_query: { type: 'string', description: '新しい担当者の名前（部分一致）。担当者を変更しない場合は省略。' },
        new_due_at: {
          type: 'string',
          description: '新しい締め切り日時。"YYYY-MM-DD HH:mm"形式（例: "2026-08-10 23:59"）。変更しない場合は省略。',
        },
        new_priority: { type: 'string', enum: ['low', 'medium', 'high'], description: '変更しない場合は省略。' },
      },
      required: ['task_title_query'],
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
  {
    name: 'remind_incomplete_task_holders',
    description:
      '指定したタスク名（部分一致・自然文でよい）に該当する、未完了（todoまたはin_progress）のタスクを持つ部員全員に、LINEでリマインダーをプッシュ送信する（アプリ管理者のみ実行可能）。「部費支払いが終わってない人にリマインドして」のような依頼で使う。該当するタスクが1件もない場合は、その旨を正直に伝えること。',
    input_schema: {
      type: 'object',
      properties: {
        task_name_query: {
          type: 'string',
          description: 'リマインドしたいタスクの名前・キーワード（部分一致で検索、例: "部費支払い"）',
        },
      },
      required: ['task_name_query'],
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
    const titleQuery = String(input.task_title_query ?? '').trim()
    if (!titleQuery) return { error: 'task_title_queryが空です' }

    let query = supabase
      .from('tasks')
      .select('id, title, status, due_at, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name)')
      .ilike('title', `%${titleQuery}%`)

    if (input.assignee_name_query) {
      const assignee = await findMemberByName(String(input.assignee_name_query))
      if (assignee) query = query.eq('assigned_to', assignee.id)
    }

    const { data: matches, error: searchError } = await query.limit(8)
    if (searchError) return { error: searchError.message }

    if (!matches || matches.length === 0) {
      return { error: '該当するタスクが見つかりませんでした。タスク名や担当者を確認してください。' }
    }

    if (matches.length > 1) {
      return {
        ambiguous: true,
        candidates: matches.map((t) => ({
          title: t.title,
          assignee: t.assignee?.full_name ?? '未割り当て',
          due_at: isoToJstDisplay(t.due_at),
          status: t.status,
        })),
        message: '複数のタスクが該当しました。どのタスクか（誰の・いつまでのタスクか）を本人に確認してから、絞り込んで再度実行してください。',
      }
    }

    const task = matches[0]
    const isOwnTask = task.assigned_to === ctx.profileId

    if (!isOwnTask && ctx.tier !== 'executive') {
      // Mirrors the 掲示板 completion flow: anyone can report someone else's
      // task as done, but only the assignee or an executive can otherwise
      // change its status (reopen it, start it, reassign, etc.).
      if (input.status !== 'done') {
        return { error: '他の人のタスクは「完了」にすることだけできます（未着手/進行中への変更は本人か三役のみ可能です）' }
      }
      const { error: rpcError } = await supabase.rpc('complete_task_via_board', { target_task_id: task.id })
      if (rpcError) return { error: rpcError.message }
      return { ok: true, task_title: task.title, assignee: task.assignee?.full_name }
    }

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

  if (name === 'search_club_knowledge') {
    const query = String(input.query ?? '').trim()
    if (!query) return { error: 'queryが空です' }
    const { data, error } = await supabase
      .from('club_knowledge')
      .select('category, topic, content')
      .or(`topic.ilike.%${query}%,content.ilike.%${query}%,category.ilike.%${query}%`)
      .order('updated_at', { ascending: false })
      .limit(10)
    if (error) return { error: error.message }
    if (!data || data.length === 0) return { matched: 0, message: '該当する知識は見つかりませんでした。' }
    return { matched: data.length, results: data }
  }

  if (name === 'save_club_knowledge') {
    const category = String(input.category ?? '').trim()
    const topic = String(input.topic ?? '').trim()
    const content = String(input.content ?? '').trim()
    if (!category || !topic || !content) return { error: 'category, topic, contentは必須です' }
    const { error } = await supabase.from('club_knowledge').upsert(
      {
        category,
        topic,
        content,
        source: input.source ? String(input.source) : null,
        added_by: ctx.profileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'topic' }
    )
    if (error) return { error: error.message }
    return { ok: true, topic }
  }

  if (name === 'list_handover_resources') {
    const { data, error } = await supabase
      .from('external_links')
      .select('category, label, url')
      .eq('is_active', true)
      .in('category', ['引継ぎ資料', '旅行Tips'])
      .order('category')
      .order('sort_order')
    if (error) return { error: error.message }
    return { resources: data ?? [] }
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

  if (name === 'update_event') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（アプリ管理者のみ実行できます）' }
    const titleQuery = String(input.event_title_query ?? '').trim()
    if (!titleQuery) return { error: 'event_title_queryが空です' }

    const { data: matches, error: searchError } = await supabase
      .from('club_events')
      .select('id, title, start_at, location')
      .ilike('title', `%${titleQuery}%`)
      .order('start_at', { ascending: false })
      .limit(8)
    if (searchError) return { error: searchError.message }
    if (!matches || matches.length === 0) return { error: '該当する予定が見つかりませんでした' }
    if (matches.length > 1) {
      return {
        ambiguous: true,
        candidates: matches.map((e) => ({ title: e.title, start_at: isoToJstDisplay(e.start_at), location: e.location })),
        message: '複数の予定が該当しました。どの予定か本人に確認してから、絞り込んで再度実行してください。',
      }
    }

    const event = matches[0]
    const updates: Record<string, unknown> = {}
    if (input.new_title) updates.title = input.new_title
    if (input.new_start_at) {
      const startAt = jstDateTimeToIso(input.new_start_at)
      if (!startAt) return { error: 'new_start_atが正しい"YYYY-MM-DD HH:mm"形式ではありません。' }
      updates.start_at = startAt
    }
    if (input.new_end_at) updates.end_at = jstDateTimeToIso(input.new_end_at)
    if (input.new_location !== undefined) updates.location = input.new_location || null
    if (input.new_category) updates.category = input.new_category
    if (input.new_visibility) updates.visibility = input.new_visibility

    if (Object.keys(updates).length === 0) return { error: '変更する項目がありません' }

    const { error } = await supabase.from('club_events').update(updates).eq('id', event.id)
    if (error) return { error: error.message }
    return { ok: true, event_title: (updates.title as string) || event.title }
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

  if (name === 'update_task') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（アプリ管理者のみ実行できます）' }
    const titleQuery = String(input.task_title_query ?? '').trim()
    if (!titleQuery) return { error: 'task_title_queryが空です' }

    let query = supabase
      .from('tasks')
      .select('id, title, due_at, assigned_to, assignee:profiles!tasks_assigned_to_fkey(full_name)')
      .ilike('title', `%${titleQuery}%`)
    if (input.assignee_name_query) {
      const currentAssignee = await findMemberByName(String(input.assignee_name_query))
      if (currentAssignee) query = query.eq('assigned_to', currentAssignee.id)
    }

    const { data: matches, error: searchError } = await query.limit(8)
    if (searchError) return { error: searchError.message }
    if (!matches || matches.length === 0) return { error: '該当するタスクが見つかりませんでした' }
    if (matches.length > 1) {
      return {
        ambiguous: true,
        candidates: matches.map((t) => ({ title: t.title, assignee: t.assignee?.full_name ?? '未割り当て', due_at: isoToJstDisplay(t.due_at) })),
        message: '複数のタスクが該当しました。どのタスクか本人に確認してから、絞り込んで再度実行してください。',
      }
    }

    const task = matches[0]
    const updates: Record<string, unknown> = {}
    if (input.new_title) updates.title = input.new_title
    if (input.new_assignee_name_query) {
      const newAssignee = await findMemberByName(String(input.new_assignee_name_query))
      if (!newAssignee) return { error: '新しい担当者が見つかりませんでした' }
      updates.assigned_to = newAssignee.id
    }
    if (input.new_due_at) {
      const dueAt = jstDateTimeToIso(input.new_due_at)
      if (!dueAt) return { error: 'new_due_atが正しい"YYYY-MM-DD HH:mm"形式ではありません。' }
      updates.due_at = dueAt
    }
    if (input.new_priority) updates.priority = input.new_priority

    if (Object.keys(updates).length === 0) return { error: '変更する項目がありません' }

    const { error } = await supabase.from('tasks').update(updates).eq('id', task.id)
    if (error) return { error: error.message }
    return { ok: true, task_title: (updates.title as string) || task.title }
  }

  if (name === 'create_announcement') {
    if (ctx.tier !== 'executive') return { error: '権限がありません（アプリ管理者のみ実行できます）' }
    const { error } = await supabase.from('announcements').insert({ title: input.title, body: input.body, created_by: ctx.profileId })
    if (error) return { error: error.message }
    return { ok: true }
  }

  if (name === 'remind_incomplete_task_holders') {
    // Re-check server-side — the tool being offered only when ctx.tier ===
    // 'executive' (see runAssistant) is a UX nicety, not the security
    // boundary. Never trust that the model only calls this when it's allowed.
    if (ctx.tier !== 'executive') return { error: '権限がありません（アプリ管理者のみ実行できます）' }

    const query = String(input.task_name_query ?? '').trim()
    if (!query) return { error: 'task_name_queryが空です' }

    const { data: matchingTasks, error } = await supabase
      .from('tasks')
      .select('id, title, due_at, assigned_to')
      .neq('status', 'done')
      .ilike('title', `%${query}%`)
    if (error) return { error: error.message }

    if (!matchingTasks || matchingTasks.length === 0) {
      return { matched_tasks: 0, message: `「${query}」に一致する未完了のタスクは見つかりませんでした。リマインドは送信していません。` }
    }

    // Batch-fetch names + LINE links for every distinct assignee up front,
    // rather than one query per task.
    const assigneeIds = [...new Set(matchingTasks.map((t) => t.assigned_to).filter((id): id is string => !!id))]
    const { data: assigneeProfiles } = assigneeIds.length
      ? await supabase.from('profiles').select('id, full_name').in('id', assigneeIds)
      : { data: [] }
    const nameByProfileId = new Map((assigneeProfiles ?? []).map((p) => [p.id, p.full_name]))

    const { data: identityRows } = assigneeIds.length
      ? await supabase.from('line_identities').select('profile_id, line_user_id').in('profile_id', assigneeIds)
      : { data: [] }
    const lineUserIdByProfileId = new Map((identityRows ?? []).map((r) => [r.profile_id, r.line_user_id]))

    const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
    const reminded: { name: string; task_title: string }[] = []
    const noLineLinked: { name: string; task_title: string }[] = []
    const failed: { name: string; task_title: string; error: string }[] = []

    for (const task of matchingTasks) {
      if (!task.assigned_to) continue // task has no assignee at all — nobody to remind
      const name = nameByProfileId.get(task.assigned_to) ?? '不明な部員'
      const lineUserId = lineUserIdByProfileId.get(task.assigned_to)

      if (!lineUserId) {
        noLineLinked.push({ name, task_title: task.title })
        continue
      }

      const lines = [`⏰ リマインダー: ${task.title}`]
      if (task.due_at) lines.push(`期限: ${isoToJstDisplay(task.due_at)}`)
      const pushResult = await pushToLine(lineUserId, lines.join('\n'), accessToken)

      if (pushResult.ok) {
        reminded.push({ name, task_title: task.title })
      } else {
        failed.push({ name, task_title: task.title, error: pushResult.error })
      }
    }

    return {
      query,
      matched_tasks: matchingTasks.length,
      reminded_count: reminded.length,
      reminded,
      no_line_linked_count: noLineLinked.length,
      no_line_linked: noLineLinked,
      failed_count: failed.length,
      failed,
    }
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
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 2048, system, messages, tools }),
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
  const customTools = ctx.tier === 'executive' ? [...BASE_TOOLS, ...EXECUTIVE_TOOLS] : BASE_TOOLS
  const tools = [...customTools, ...SERVER_TOOLS]
  const glossaryText = ctx.glossary.length
    ? `\n\n[部内用語集 — これまでの会話で学んだ言葉]\n${ctx.glossary.map((g) => `・${g.term}: ${g.definition}`).join('\n')}`
    : ''
  const itineraryGuidance = `\n\n[旅程の相談を受けたときの考え方]\n合宿・遠征などの旅程相談では、「何時にどこへ移動する」だけでなく、現地で実際に起こりうる詰まりどころまで具体的に考えること。例えば「オシュからカシュガルへ国境を越える」なら、次のレベルの粒度で考える:\n・国境の営業時間や当日の状況はネットに出ていないことが多いので、前日に現地の人に聞く、朝一番で向かう、ダメだった場合の予備日を用意する、といった段取りを立てる\n・両替・支払いをどこで済ませるか（窓口の場所、現金の要否）を事前に把握しておく\n・現地で何も手に入らない前提で、水・食料を余分に持っておく\n・集合場所や検問で自分だけ置いていかれないように、誰がどう確認を取るかを決めておく\nこのように「情報が事前に取れない・不確実な場面でどう備えるか」を具体的に提案すること。抽象的な注意喚起（「気をつけましょう」など）で終わらせないこと。関連しそうな情報は、search_club_knowledgeや資料ページのlist_handover_resources（必要ならweb_fetchで中身を読む）で過去の知見を確認し、現地の営業時間・料金・最新情報などネットで調べられそうなことはweb_searchを使って調べること。旅程相談の中で今後も使えそうな知見を得たら、save_club_knowledgeで記録しておく。`
  const disambiguationGuidance = `\n\n[曖昧な依頼への対応]\nタスクや予定の操作で、名前や件名だけでは対象が1件に絞れない場合（update_task_status/update_task/update_eventがambiguous:trueを返した場合など）、憶測でどれか1つを選んで実行してはいけない。候補（誰の・何という・いつの予定/タスクか）を挙げて、本人にどれのことか確認してから、絞り込んで再度ツールを呼び出すこと。`
  const shiritoriGuidance = `\n\n[しりとりのルール]\n毎ターン、次の順番で確認すること。\n1. 相手の単語が漢字を含む場合、まず正しい読み方(カタカナ)に変換する。読み方に自信がない場合は、憶測で確定させず「読み方に自信がないので確認してもいいですか」のように正直に伝えること。\n2. 読みの末尾が「ん」なら、そこでしりとりは負け(終了)。その旨を伝えてゲームを終えること。\n3. これまでに出た単語と重複していないか確認する。判定は表記(漢字/カタカナ/ひらがな)ではなく読み方で行うこと(例:「白樺」と「シラカバ」は同じ単語として扱う)。会話履歴に出てきた単語を毎回すべて読みに変換してから比較すること。\n4. 相手の単語が実在するか怪しい場合(マイナーな地名など)、知らないと決めつけて拒否する前に、web_searchで実在するか確認してから判断すること。\n5. 自分が次に出す単語は、末尾が「ん」にならないものを選ぶこと。`
  const system = `${ctx.persona}\n\n[話しかけている部員の情報]\n名前: ${ctx.callerName}\n役職: ${ctx.callerRole}\n権限区分: ${ctx.tier}\n今日の日付: ${new Date().toISOString().slice(0, 10)}\nこの情報は事実として使ってよいが、部員本人に「あなたは○○さんですね」のように毎回確認する必要はない。${glossaryText}${itineraryGuidance}${disambiguationGuidance}${shiritoriGuidance}\n\n重要: ツール呼び出しが必要な用件だけでなく、雑談・しりとりなどの言葉遊び・ちょっとした相談にも普通に応じてよい。「秘書だからできない」のように用件外だからと安易に断らないこと。ただし、返信の中で事実として述べる内容（予定・タスク・部員情報など）は、ツールの実行結果に含まれるものだけにすること。実行していない操作をあたかも実行したかのように書いてはいけない。複数の依頼のうち一部しか実行できなかった場合は、実行できた分とできなかった分を正直に分けて伝えること。会話の中で部内だけで通じる言葉・ネタ・言い回しに気づいたら、save_glossary_termで記録しておくとよい。場所・旅程・ノウハウなど部として再利用できそうな知識に気づいたら、save_club_knowledgeで記録しておくとよい(特定個人の私的な情報は保存しないこと。承認や確認は不要)。`
  const messages = [...history, { role: 'user', content: userText }]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(system, messages, tools, apiKey)
    messages.push({ role: 'assistant', content: response.content })

    // pause_turn happens when a server tool (web_search/web_fetch) is still
    // running (e.g. a long search) — resume by resending the same messages
    // unchanged, with no new user turn, rather than treating it as final.
    if (response.stop_reason === 'pause_turn') continue

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
        .select('id, full_name, club_roles!profiles_club_role_id_fkey(label_ja, tier)')
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

      // Ordered by seq (a monotonic sequence), not created_at -- the two
      // messages of a turn are inserted in one statement below and so can
      // share an identical created_at, which created_at-only ordering
      // can't break ties on consistently.
      const { data: recentMessages } = await supabase
        .from('ai_secretary_messages')
        .select('role, content')
        .eq('conversation_id', conversation.id)
        .order('seq', { ascending: false })
        .limit(30)

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
