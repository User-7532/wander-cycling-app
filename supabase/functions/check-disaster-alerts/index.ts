import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const JMA_AREA_URL = 'https://www.jma.go.jp/bosai/common/const/area.json'
const JMA_WARNING_URL = (code: string) => `https://www.jma.go.jp/bosai/warning/data/warning/${code}.json`
const LINE_MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast'

// Hokkaido is split into 8 JMA offices rather than one prefecture-wide code;
// these are the everyday regional names people actually write in event text.
const HOKKAIDO_ALIASES: Record<string, string> = {
  道南: '017000',
  道央: '016000',
  道北: '012000',
  道東: '014100',
  オホーツク: '013000',
  十勝: '014030',
  日高: '015000',
  宗谷: '011000',
}

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

interface OfficeMatch {
  officeName: string
  events: { title: string; start_at: string; visibility: string; id: string }[]
}

serve(async (req) => {
  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    // 1. Build a prefecture/region-name -> JMA office-code map from JMA's own
    // authoritative (and effectively static) area master, rather than a
    // hand-typed table that could drift or contain typos.
    const areaRes = await fetch(JMA_AREA_URL)
    const area = await areaRes.json()
    const officeNameByCode: Record<string, string> = {}
    for (const [code, info] of Object.entries<{ name: string }>(area.offices ?? {})) {
      officeNameByCode[code] = info.name
    }

    // 2. Pull events happening in the next 14 days. start_at/end_at are
    // timestamptz now; end_at may be null for a single-day event, in which
    // case we treat it as ending the same instant it starts for the purpose
    // of checking overlap with the lookahead window.
    const now = new Date().toISOString()
    const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    const { data: events } = await supabase
      .from('club_events')
      .select('id, title, description, location, start_at, end_at, visibility')
      .lte('start_at', twoWeeksOut)
      .or(`end_at.gte.${now},and(end_at.is.null,start_at.gte.${now})`)

    // 3. Match each event's free-text location/description against known
    // prefecture names and the Hokkaido regional aliases above.
    const matches: Record<string, OfficeMatch> = {}
    for (const e of events ?? []) {
      const text = `${e.title} ${e.description ?? ''} ${e.location ?? ''}`
      for (const [code, name] of Object.entries(officeNameByCode)) {
        if (text.includes(name)) {
          matches[code] ??= { officeName: name, events: [] }
          matches[code].events.push(e)
        }
      }
      for (const [alias, code] of Object.entries(HOKKAIDO_ALIASES)) {
        if (text.includes(alias)) {
          matches[code] ??= { officeName: officeNameByCode[code] ?? alias, events: [] }
          matches[code].events.push(e)
        }
      }
    }

    const results: Record<string, unknown> = {}

    // 4. For every matched region, check JMA's current warnings and notify
    // only if the headline actually changed since we last checked.
    for (const [code, match] of Object.entries(matches)) {
      const warnRes = await fetch(JMA_WARNING_URL(code))
      if (!warnRes.ok) {
        results[code] = { skipped: 'fetch failed' }
        continue
      }
      const warning = await warnRes.json()
      const headline: string = warning.headlineText ?? ''

      const { data: state } = await supabase.from('disaster_alert_state').select('last_headline').eq('office_code', code).maybeSingle()
      const previousHeadline = state?.last_headline ?? ''

      await supabase
        .from('disaster_alert_state')
        .upsert({ office_code: code, office_name: match.officeName, last_headline: headline, updated_at: new Date().toISOString() })

      if (!headline || headline === previousHeadline) {
        results[code] = { notified: false, headline }
        continue
      }

      const eventTitles = match.events.map((e) => e.title).join('、')
      const text = `⚠️ ${match.officeName}の気象情報\n\n${headline}\n\n関連する予定: ${eventTitles}\n\n最新情報は気象庁HPでご確認ください。`.slice(0, 4900)
      const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!

      const hasPublicEvent = match.events.some((e) => e.visibility === 'all')

      if (hasPublicEvent) {
        const to = await getNonObLineUserIds()
        if (to.length > 0) {
          await sendMulticast(to, [{ type: 'text', text }], accessToken)
        }
        results[code] = { notified: 'multicast', headline, recipients: to.length }
      } else {
        const inviteOnlyEventIds = match.events.map((e) => e.id)
        const { data: invitees } = await supabase.from('event_invitees').select('profile_id').in('event_id', inviteOnlyEventIds)
        const profileIds = [...new Set((invitees ?? []).map((i) => i.profile_id))]
        if (profileIds.length > 0) {
          const { data: identities } = await supabase.from('line_identities').select('line_user_id').in('profile_id', profileIds)
          const to = (identities ?? []).map((i) => i.line_user_id)
          if (to.length > 0) {
            await fetch(LINE_MULTICAST_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
            })
          }
        }
        results[code] = { notified: 'multicast', headline }
      }
    }

    return new Response(JSON.stringify({ checked: Object.keys(matches).length, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('check-disaster-alerts error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
