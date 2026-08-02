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
    const { code, redirect_uri } = await req.json()
    console.log('受け取ったcode:', code, 'redirect_uri:', redirect_uri)

    const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        'grant_type': 'authorization_code',
        code,
        // Must match whatever origin actually sent the user to LINE — passed
        // through from the frontend rather than fixed here, so both
        // localhost (dev) and the production domain work with one deployment.
        redirect_uri: redirect_uri || Deno.env.get('LINE_REDIRECT_URI')!,
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
    const lineProfile = await profileResponse.json()
    console.log('LINEプロフィール:', JSON.stringify(lineProfile))

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const email = `${lineProfile.userId}@line.wandercycling.app`

    // Prefer looking the user up by their stable LINE id (already-linked members).
    const { data: existingIdentity } = await supabase
      .from('line_identities')
      .select('profile_id')
      .eq('line_user_id', lineProfile.userId)
      .maybeSingle()

    let authUserId = existingIdentity?.profile_id

    if (!authUserId) {
      // Not linked yet — fall back to matching by the synthetic email (covers
      // accounts created before line_identities existed), otherwise create new.
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({
        perPage: 1000,
      })
      console.log('ユーザー一覧取得:', listError ? listError.message : 'OK')

      const existingUser = users?.find((u) => u.email === email)

      if (existingUser) {
        authUserId = existingUser.id
      } else {
        const { data: created, error: createError } = await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            name: lineProfile.displayName,
            avatar: lineProfile.pictureUrl,
            line_id: lineProfile.userId,
          },
        })
        console.log('新規ユーザー作成:', createError ? createError.message : 'OK')
        if (createError || !created?.user) {
          throw new Error(`ユーザー作成失敗: ${createError?.message}`)
        }
        authUserId = created.user.id
      }

      // Ensure a profile + line_identities row exists (defaults to 一般部員/general tier).
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(
          { id: authUserId, full_name: lineProfile.displayName, avatar_url: lineProfile.pictureUrl },
          { onConflict: 'id', ignoreDuplicates: true }
        )
      console.log('profiles upsert:', profileError ? profileError.message : 'OK')

      const { error: identityError } = await supabase.from('line_identities').upsert(
        {
          line_user_id: lineProfile.userId,
          profile_id: authUserId,
          display_name: lineProfile.displayName,
          picture_url: lineProfile.pictureUrl,
        },
        { onConflict: 'line_user_id' }
      )
      console.log('line_identities upsert:', identityError ? identityError.message : 'OK')
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
