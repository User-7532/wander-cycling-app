import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Runs hourly (via pg_cron, see migration 0037) and pushes a LINE reminder
// to anyone who hasn't RSVP'd yet on an event whose rsvp_deadline is
// approaching. Same pg_net + pg_cron + vault-webhook-secret pattern as
// task-deadline-reminders (see 0032_schedule_task_deadline_reminders_cron.sql).
//
// Lookahead window: events whose rsvp_deadline is in the future but within
// the next 24 hours. An hourly cron with a 24h window means everyone still
// gets a reminder even if a run is missed, while avoiding reminders so far
// out that they're easy to ignore.
//
// Eligible pool: all profiles for visibility='all' events, or the
// event_invitees list for invite_only events. "Hasn't voted" means no row
// in event_registrations for that event+profile (any status -- attending,
// undecided, or not_attending -- counts as having voted).
//
// Dedup: event_invitees has no per-row status to piggyback a "reminded"
// flag onto, and visibility='all' events have no per-person row at all, so
// rsvp_reminder_log (event_id, profile_id) tracks who has already been
// reminded for a given event. A row is only written after a push actually
// succeeds, so a profile with no linked LINE identity is safely retried
// every run rather than being silently marked "done".

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000

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

serve(async (req) => {
  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const now = new Date()
    const nowIso = now.toISOString()
    const lookaheadIso = new Date(now.getTime() + LOOKAHEAD_MS).toISOString()

    const { data: events, error } = await supabase
      .from('club_events')
      .select('id, title, rsvp_deadline, visibility')
      .not('rsvp_deadline', 'is', null)
      .gt('rsvp_deadline', nowIso)
      .lte('rsvp_deadline', lookaheadIso)

    if (error) {
      console.error('rsvp-reminder query error:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    const results: Record<string, unknown> = {}

    for (const event of events ?? []) {
      let eligibleIds: string[]
      if (event.visibility === 'all') {
        const { data: profiles, error: profilesError } = await supabase.from('profiles').select('id')
        if (profilesError) {
          results[event.id] = { error: profilesError.message }
          continue
        }
        eligibleIds = (profiles ?? []).map((p) => p.id)
      } else {
        const { data: invitees, error: inviteesError } = await supabase
          .from('event_invitees')
          .select('profile_id')
          .eq('event_id', event.id)
        if (inviteesError) {
          results[event.id] = { error: inviteesError.message }
          continue
        }
        eligibleIds = (invitees ?? []).map((i) => i.profile_id)
      }

      if (eligibleIds.length === 0) {
        results[event.id] = { eligible: 0 }
        continue
      }

      const [{ data: voted, error: votedError }, { data: reminded, error: remindedError }] = await Promise.all([
        supabase.from('event_registrations').select('profile_id').eq('event_id', event.id),
        supabase.from('rsvp_reminder_log').select('profile_id').eq('event_id', event.id),
      ])
      if (votedError || remindedError) {
        results[event.id] = { error: votedError?.message ?? remindedError?.message }
        continue
      }

      const votedIds = new Set((voted ?? []).map((v) => v.profile_id))
      const remindedIds = new Set((reminded ?? []).map((r) => r.profile_id))
      const targetIds = eligibleIds.filter((id) => !votedIds.has(id) && !remindedIds.has(id))

      if (targetIds.length === 0) {
        results[event.id] = { eligible: eligibleIds.length, targets: 0 }
        continue
      }

      const { data: identities, error: identitiesError } = await supabase
        .from('line_identities')
        .select('profile_id, line_user_id')
        .in('profile_id', targetIds)
      if (identitiesError) {
        results[event.id] = { error: identitiesError.message }
        continue
      }
      const identityByProfile = new Map((identities ?? []).map((i) => [i.profile_id, i.line_user_id]))

      const text = [
        '投票期限が近づいています',
        '',
        event.title,
        `投票期限: ${formatDateTime(event.rsvp_deadline)}`,
        '',
        'まだ参加登録が完了していません。アプリからご回答ください。',
      ].join('\n')

      const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
      let sent = 0
      let noIdentity = 0
      const errors: string[] = []

      for (const profileId of targetIds) {
        const lineUserId = identityByProfile.get(profileId)
        if (!lineUserId) {
          noIdentity++
          continue
        }

        const res = await fetch(LINE_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
        })

        if (!res.ok) {
          const errText = await res.text()
          console.error('LINE push failed:', errText)
          errors.push(`${profileId}: ${errText}`)
          continue
        }

        const { error: logError } = await supabase
          .from('rsvp_reminder_log')
          .insert({ event_id: event.id, profile_id: profileId })
        if (logError) {
          console.error('rsvp_reminder_log insert error:', logError)
          errors.push(`${profileId}: log insert failed: ${logError.message}`)
          continue
        }
        sent++
      }

      results[event.id] = { eligible: eligibleIds.length, targets: targetIds.length, sent, noIdentity, errors }
    }

    return new Response(JSON.stringify({ checked: events?.length ?? 0, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('rsvp-reminder error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
