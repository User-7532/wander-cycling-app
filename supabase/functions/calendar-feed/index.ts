import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ICS feed of the club schedule (+ personal tasks when a token is given).
//
// - No token / invalid token: public, no-auth feed. Only club_events with
//   visibility = 'all' (never invite_only ones), no tasks. Anyone with the
//   plain URL can subscribe to this from Apple Calendar / Google Calendar,
//   so it must stay free of anything personal or invite-only.
// - Valid token (matches a profiles.calendar_feed_token): personalized feed
//   for that member — visibility='all' events, PLUS invite_only events they
//   are personally invited to (via event_invitees), PLUS their own tasks as
//   VTODO components.

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// club_events.start_at / end_at are timestamptz (minute precision). When
// end_at is present we emit a real timed VEVENT (DTSTART/DTEND as UTC
// DATE-TIME). When end_at is null the event has no defined end -- treat it
// as an all-day VEVENT (VALUE=DATE, date part of start_at only), but don't
// lose the meeting time: it's prepended to the DESCRIPTION as "集合時間: HH:MM".
// Per RFC 5545, DTEND for an all-day event is EXCLUSIVE (the day after the
// last day covered), so we add one day when building an all-day DTEND.

function toICSDateOnly(iso: string): string {
  // Date part of an ISO timestamp, in Asia/Tokyo (the club's local day),
  // formatted as YYYYMMDD.
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) // "YYYY-MM-DD"
  return parts.replace(/-/g, '')
}

function addDaysToICSDate(icsDate: string, days: number): string {
  const y = Number(icsDate.slice(0, 4))
  const m = Number(icsDate.slice(4, 6))
  const day = Number(icsDate.slice(6, 8))
  const d = new Date(Date.UTC(y, m - 1, day))
  d.setUTCDate(d.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

function formatDateTimeUTC(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function formatMeetingTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

// RFC 5545 TEXT escaping: backslash first, then comma/semicolon, then newlines.
function escapeText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

// RFC 5545 line folding: no content line may exceed 75 octets (UTF-8 bytes).
// Continuation lines start with a single space, which itself counts toward
// that line's 75-octet budget. Multi-byte UTF-8 characters (e.g. Japanese
// text) must never be split across a fold.
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line

  const decoder = new TextDecoder()
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Don't split a multi-byte UTF-8 sequence: back off while the byte at
    // `end` is a continuation byte (10xxxxxx).
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--
    }
    parts.push(decoder.decode(bytes.slice(start, end)))
    start = end
    limit = 74 // subsequent lines are prefixed with 1 space -> 74 + 1 = 75
  }
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join('\r\n')
}

// ICS PRIORITY: 1 = highest ... 9 = lowest. 0 = undefined.
const ICS_PRIORITY: Record<string, number> = { high: 1, medium: 5, low: 9 }

function buildEventLines(event: {
  id: string
  title: string
  description: string | null
  location: string | null
  start_at: string
  end_at: string | null
}, dtstamp: string): string[] {
  const lines: string[] = []
  lines.push('BEGIN:VEVENT')
  lines.push(`UID:${event.id}@wandercycling.app`)
  lines.push(`DTSTAMP:${dtstamp}`)

  let description = event.description ?? ''

  if (event.end_at) {
    lines.push(`DTSTART:${formatDateTimeUTC(new Date(event.start_at))}`)
    lines.push(`DTEND:${formatDateTimeUTC(new Date(event.end_at))}`)
  } else {
    const startDate = toICSDateOnly(event.start_at)
    lines.push(`DTSTART;VALUE=DATE:${startDate}`)
    lines.push(`DTEND;VALUE=DATE:${addDaysToICSDate(startDate, 1)}`)
    const meetingTime = `集合時間: ${formatMeetingTime(event.start_at)}`
    description = description ? `${meetingTime}\n${description}` : meetingTime
  }

  lines.push(`SUMMARY:${escapeText(event.title)}`)
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`)
  lines.push('END:VEVENT')
  return lines
}

function buildTodoLines(task: {
  id: string
  title: string
  description: string | null
  due_at: string | null
  status: string
  priority: string | null
}, dtstamp: string): string[] {
  const lines: string[] = []
  lines.push('BEGIN:VTODO')
  lines.push(`UID:${task.id}@wandercycling.app`)
  lines.push(`DTSTAMP:${dtstamp}`)
  if (task.due_at) lines.push(`DUE:${formatDateTimeUTC(new Date(task.due_at))}`)
  lines.push(`SUMMARY:${escapeText(task.title)}`)
  if (task.description) lines.push(`DESCRIPTION:${escapeText(task.description)}`)
  lines.push(`STATUS:${task.status === 'done' ? 'COMPLETED' : 'NEEDS-ACTION'}`)
  const priority = task.priority ? ICS_PRIORITY[task.priority] : undefined
  if (priority) lines.push(`PRIORITY:${priority}`)
  lines.push('END:VTODO')
  return lines
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    let profileId: string | null = null
    if (token) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('calendar_feed_token', token)
        .maybeSingle()
      profileId = profile?.id ?? null
    }

    let events: {
      id: string
      title: string
      description: string | null
      location: string | null
      start_at: string
      end_at: string | null
    }[] = []

    if (profileId) {
      const { data: inviteeRows } = await supabase
        .from('event_invitees')
        .select('event_id')
        .eq('profile_id', profileId)
      const invitedEventIds = [...new Set((inviteeRows ?? []).map((r) => r.event_id))]

      const orFilter =
        invitedEventIds.length > 0
          ? `visibility.eq.all,id.in.(${invitedEventIds.join(',')})`
          : 'visibility.eq.all'

      const { data, error } = await supabase
        .from('club_events')
        .select('id, title, description, location, start_at, end_at')
        .or(orFilter)
        .order('start_at', { ascending: true })
      if (error) {
        console.error('calendar-feed events query error:', error)
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
      }
      events = data ?? []
    } else {
      const { data, error } = await supabase
        .from('club_events')
        .select('id, title, description, location, start_at, end_at')
        .eq('visibility', 'all')
        .order('start_at', { ascending: true })
      if (error) {
        console.error('calendar-feed events query error:', error)
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
      }
      events = data ?? []
    }

    let tasks: {
      id: string
      title: string
      description: string | null
      due_at: string | null
      status: string
      priority: string | null
    }[] = []

    if (profileId) {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, due_at, status, priority')
        .eq('assigned_to', profileId)
      if (error) {
        console.error('calendar-feed tasks query error:', error)
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
      }
      tasks = data ?? []
    }

    const dtstamp = formatDateTimeUTC(new Date())

    const lines: string[] = []
    lines.push('BEGIN:VCALENDAR')
    lines.push('VERSION:2.0')
    lines.push('PRODID:-//WanderCycling//Calendar Feed//JA')
    lines.push('CALSCALE:GREGORIAN')

    for (const event of events) {
      lines.push(...buildEventLines(event, dtstamp))
    }
    for (const task of tasks) {
      lines.push(...buildTodoLines(task, dtstamp))
    }

    lines.push('END:VCALENDAR')

    const body = lines.map(foldLine).join('\r\n') + '\r\n'

    return new Response(body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="wandercycling.ics"',
      },
    })
  } catch (err) {
    console.error('calendar-feed error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
