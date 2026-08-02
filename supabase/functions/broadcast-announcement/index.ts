import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LINE_BROADCAST_URL = 'https://api.line.me/v2/bot/message/broadcast'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  const expectedSecret = Deno.env.get('BROADCAST_WEBHOOK_SECRET')
  const providedSecret = req.headers.get('x-webhook-secret')
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const { id } = await req.json()
    const { data: announcement, error } = await supabase.from('announcements').select('title, body').eq('id', id).single()
    if (error || !announcement) {
      return new Response(JSON.stringify({ error: error?.message ?? 'announcement not found' }), { status: 404 })
    }

    const text = `📢 ${announcement.title}\n\n${announcement.body}`.slice(0, 4900)

    const accessToken = Deno.env.get('LINE_BOT_CHANNEL_ACCESS_TOKEN')!
    const res = await fetch(LINE_BROADCAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ messages: [{ type: 'text', text }] }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('LINE broadcast failed:', errText)
      return new Response(JSON.stringify({ error: errText }), { status: 502 })
    }

    return new Response('ok')
  } catch (err) {
    console.error('broadcast-announcement error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
