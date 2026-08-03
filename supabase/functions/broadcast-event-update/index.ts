import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Handles both "created" and "updated" club_events notifications. Targeting
// logic mirrors check-disaster-alerts: visibility='all' -> multicast to
// every non-OB member's LINE id; visibility='invite_only' -> multicast to
// just the invitees' LINE ids (looked up via event_invitees -> line_identities).

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

    const { data: event, error } = await supabase
      .from('club_events')
      .select('id, title, description, start_at, location, meeting_point, visibility, status')
      .eq('id', id)
      .single()
    if (error || !event) {
      return new Response(JSON.stringify({ error: error?.message ?? 'event not found' }), { status: 404 })
    }

    const header = isUpdate ? '🔄 予定が更新されました' : '🆕 新しい予定が追加されました'
    const lines = [header, '', event.title]
    if (event.start_at) lines.push(`日時: ${formatDateTime(event.start_at)}`)
    if (event.location) lines.push(`場所: ${event.location}`)
    if (event.meeting_point) lines.push(`集合場所: ${event.meeting_point}`)
    if (event.status === 'cancelled') lines.push('※ このイベントは中止になりました')
    if (event.description) lines.push('', event.description)
    const text = lines.join('\n').slice(0, 4900)

    const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!

    if (event.visibility === 'all') {
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
    }

    const { data: invitees } = await supabase.from('event_invitees').select('profile_id').eq('event_id', event.id)
    const profileIds = [...new Set((invitees ?? []).map((i) => i.profile_id))]
    if (profileIds.length === 0) {
      return new Response(JSON.stringify({ notified: false, reason: 'no invitees' }))
    }

    const { data: identities } = await supabase.from('line_identities').select('line_user_id').in('profile_id', profileIds)
    const to = (identities ?? []).map((i) => i.line_user_id)
    if (to.length === 0) {
      return new Response(JSON.stringify({ notified: false, reason: 'no linked LINE ids for invitees' }))
    }

    const res = await fetch(LINE_MULTICAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('LINE multicast failed:', errText)
      return new Response(JSON.stringify({ error: errText }), { status: 502 })
    }
    return new Response(JSON.stringify({ notified: 'multicast', recipients: to.length }))
  } catch (err) {
    console.error('broadcast-event-update error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
