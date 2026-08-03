import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Public, no-auth ICS feed of the club schedule. Anyone with the URL can
// subscribe to it from Apple Calendar / Google Calendar, so this must only
// ever expose events with visibility = 'all' (never invite_only ones).

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// club_events.start_date / end_date are plain SQL `date` columns (no time-of-day,
// no timezone) — every event is an all-day (or multi-day, all-day) event. So we
// emit VALUE=DATE VEVENTs rather than DATE-TIME ones, and there is no timezone
// conversion to do. Per RFC 5545, DTEND for an all-day event is EXCLUSIVE (the
// day after the last day the event covers), while our stored end_date is
// INCLUSIVE (the last day of the event), so we add one day when building DTEND.

function toICSDate(dateStr: string): string {
  return dateStr.replace(/-/g, '')
}

function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

function formatDateTimeUTC(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { data: events, error } = await supabase
      .from('club_events')
      .select('id, title, description, location, start_date, end_date')
      .eq('visibility', 'all')
      .order('start_date', { ascending: true })

    if (error) {
      console.error('calendar-feed query error:', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }

    const dtstamp = formatDateTimeUTC(new Date())

    const lines: string[] = []
    lines.push('BEGIN:VCALENDAR')
    lines.push('VERSION:2.0')
    lines.push('PRODID:-//WanderCycling//Calendar Feed//JA')
    lines.push('CALSCALE:GREGORIAN')

    for (const event of events ?? []) {
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${event.id}@wandercycling.app`)
      lines.push(`DTSTAMP:${dtstamp}`)
      lines.push(`DTSTART;VALUE=DATE:${toICSDate(event.start_date)}`)
      lines.push(`DTEND;VALUE=DATE:${addDaysToDateString(event.end_date ?? event.start_date, 1)}`)
      lines.push(`SUMMARY:${escapeText(event.title)}`)
      if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
      if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
      lines.push('END:VEVENT')
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
