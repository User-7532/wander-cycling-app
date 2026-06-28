import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log('Function called:', req.method)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code } = await req.json()
    console.log('受け取ったcode:', code)

    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        'grant_type': 'authorization_code',
        code,
        redirect_uri: Deno.env.get('LINE_REDIRECT_URI')!,
        client_id: Deno.env.get('LINE_CHANNEL_ID')!,
        client_secret: Deno.env.get('LINE_CHANNEL_SECRET')!,
      }),
    })

    const tokenData = await tokenResponse.json()
    console.log('LINEトークンレスポンス:', JSON.stringify(tokenData))

    if (!tokenData.access_token) {
      throw new Error(`LINEトークン取得失敗: ${JSON.stringify(tokenData)}`)
    }

    console.log('プロフィール取得開始')
    const profileResponse = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    console.log('プロフィール取得ステータス:', profileResponse.status)
    const profile = await profileResponse.json()
    console.log('LINEプロフィール:', JSON.stringify(profile))

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const email = `${profile.userId}@line.wandercycling.app`

    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({
      perPage: 1000
    })
    console.log('ユーザー一覧取得:', listError ? listError.message : 'OK')

    const existingUser = users?.find(u => u.email === email)
    console.log('既存ユーザー:', existingUser ? '見つかった' : '見つからない')

    if (!existingUser) {
      const { error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          name: profile.displayName,
          avatar: profile.pictureUrl,
          line_id: profile.userId,
        },
      })
      console.log('新規ユーザー作成:', createError ? createError.message : 'OK')
    }

    const { data: sessionData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    console.log('マジックリンク生成:', linkError ? linkError.message : 'OK')

    return new Response(
      JSON.stringify({ url: sessionData?.properties?.action_link }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.log('エラー発生:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})