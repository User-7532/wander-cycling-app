import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Fired by a trigger on profile_leave_events (event_type='left', see
// 0051_notify_yakuin_on_leave.sql), which itself fires from leave_club()
// (0050_member_leave_and_restore.sql). Notifies every current 三役
// (is_yakuin=true role holder) via LINE multicast, since departures are
// exactly the kind of thing 三役 need to know about promptly (fee/gear
// handoffs, updating external rosters, etc.) -- not the departing member
// themself, and not a broadcast to everyone.
const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const { profile_id } = await req.json()

    const { data: leaver, error: leaverErr } = await supabase.from('profiles').select('id, full_name').eq('id', profile_id).single()
    if (leaverErr || !leaver) {
      return new Response(JSON.stringify({ error: leaverErr?.message ?? 'profile not found' }), { status: 404 })
    }

    const { data: yakuinRoles, error: rolesErr } = await supabase.from('profile_roles').select('profile_id, club_roles!inner(is_yakuin)').eq('club_roles.is_yakuin', true)
    if (rolesErr) throw rolesErr

    const yakuinProfileIds = [...new Set((yakuinRoles ?? []).map((r) => r.profile_id))].filter((id) => id !== profile_id)
    if (yakuinProfileIds.length === 0) {
      return new Response(JSON.stringify({ notified: false, reason: 'no 三役 to notify' }))
    }

    const { data: identities, error: identitiesErr } = await supabase.from('line_identities').select('profile_id, line_user_id').in('profile_id', yakuinProfileIds)
    if (identitiesErr) throw identitiesErr

    const lineUserIds = (identities ?? []).map((i) => i.line_user_id)
    if (lineUserIds.length === 0) {
      return new Response(JSON.stringify({ notified: false, reason: '三役 have no linked LINE id' }))
    }

    const text = [`📤 ${leaver.full_name}さんが退部しました`, '', '間違って退部した場合は、メンバー管理から復元できます。'].join('\n').slice(0, 4900)

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
    console.error('notify-member-left error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
