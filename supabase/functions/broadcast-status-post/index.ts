import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// Everyone with a linked LINE account except explicitly-tagged OB (graduated)
// members -- the club wants general-audience notifications to stop once
// someone graduates, but anyone with no active_status assignment yet (e.g.
// cohort_year not set) should still be notified. active_status is fully
// automated (see update-member-status-attributes), so this always re-derives
// current OB membership from profile_attribute_values rather than caching it.
async function getNonObLineUserIds(): Promise<string[]> {
  const { data: identities } = await supabase.from('line_identities').select('profile_id, line_user_id')
  if (!identities || identities.length === 0) return []

  const { data: attr } = await supabase.from('member_attributes').select('id').eq('key', 'active_status').maybeSingle()
  const { data: obValue } = attr
    ? await supabase.from('member_attribute_values').select('id').eq('attribute_id', attr.id).eq('value', 'OB').maybeSingle()
    : { data: null }
  if (!obValue) return identities.map((i) => i.line_user_id)

  const { data: obRows } = await supabase.from('profile_attribute_values').select('profile_id').eq('attribute_value_id', obValue.id)
  const obProfileIds = new Set((obRows ?? []).map((r) => r.profile_id))

  return identities.filter((i) => !obProfileIds.has(i.profile_id)).map((i) => i.line_user_id)
}

// LINE multicast caps recipients at 500 per call, so chunk.
async function sendMulticast(to: string[], messages: unknown[], accessToken: string) {
  for (let i = 0; i < to.length; i += 500) {
    const chunk = to.slice(i, i + 500)
    const res = await fetch(LINE_MULTICAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to: chunk, messages }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('LINE multicast failed:', errText)
      throw new Error(errText)
    }
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  status: '状況報告',
  task_done: 'タスク完了',
  facility_reservation: '施設予約',
  crowding_info: '混雑情報',
  other: 'その他',
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const { id } = await req.json()
    const { data: post, error } = await supabase
      .from('status_posts')
      .select('message, category, author:profiles!status_posts_author_id_fkey(full_name)')
      .eq('id', id)
      .single()
    if (error || !post) {
      return new Response(JSON.stringify({ error: error?.message ?? 'post not found' }), { status: 404 })
    }

    const categoryLabel = CATEGORY_LABEL[post.category] ?? post.category
    const authorName = post.author?.full_name ?? '部員'
    const text = `📍 掲示板より（${categoryLabel}）\n${authorName}: ${post.message}`.slice(0, 4900)

    const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
    const to = await getNonObLineUserIds()
    if (to.length === 0) {
      return new Response(JSON.stringify({ notified: false, reason: 'no non-OB linked LINE ids' }))
    }

    try {
      await sendMulticast(to, [{ type: 'text', text }], accessToken)
    } catch (multicastErr) {
      return new Response(JSON.stringify({ error: String(multicastErr) }), { status: 502 })
    }

    return new Response(JSON.stringify({ notified: 'multicast', recipients: to.length }))
  } catch (err) {
    console.error('broadcast-status-post error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
