import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')
    const anonClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const {
      data: { user },
      error: userError,
    } = await anonClient.auth.getUser(jwt)
    if (userError || !user) {
      return new Response(JSON.stringify({ error: '認証が必要です' }), { status: 401, headers: corsHeaders })
    }

    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: profile } = await admin.from('profiles').select('id, club_roles(tier)').eq('id', user.id).single()
    const tier = profile?.club_roles?.tier ?? 'general'
    const isOfficerPlus = tier === 'executive' || tier === 'officer'
    const isExecutive = tier === 'executive'

    const body = await req.json()

    if (body.action === 'reveal') {
      const { data: entry } = await admin.from('account_directory').select('*').eq('id', body.entry_id).single()
      if (!entry) return new Response(JSON.stringify({ error: '見つかりません' }), { status: 404, headers: corsHeaders })

      const allowed = entry.min_tier === 'executive' ? isExecutive : isOfficerPlus
      if (!allowed) return new Response(JSON.stringify({ error: '権限がありません' }), { status: 403, headers: corsHeaders })
      if (!entry.vault_secret_id) return new Response(JSON.stringify({ error: 'パスワードが未設定です' }), { status: 404, headers: corsHeaders })

      const { data: secret, error: revealError } = await admin.rpc('admin_reveal_vault_secret', { secret_id: entry.vault_secret_id })
      if (revealError) throw revealError

      await admin.from('account_directory_access_log').insert({ entry_id: entry.id, accessed_by: user.id })

      return new Response(JSON.stringify({ secret }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (body.action === 'set') {
      if (!isExecutive) return new Response(JSON.stringify({ error: '権限がありません（執行部のみ）' }), { status: 403, headers: corsHeaders })

      let entryId = body.entry_id
      let vaultSecretId = null

      if (entryId) {
        const { data: existing } = await admin.from('account_directory').select('vault_secret_id').eq('id', entryId).single()
        vaultSecretId = existing?.vault_secret_id ?? null
      }

      if (body.secret_value) {
        const { data: newVaultId, error: vaultError } = await admin.rpc('admin_set_vault_secret', {
          existing_id: vaultSecretId,
          secret_value: body.secret_value,
          secret_name: `account_directory_${entryId ?? crypto.randomUUID()}`,
        })
        if (vaultError) throw vaultError
        vaultSecretId = newVaultId
      }

      const payload = {
        service_name: body.service_name,
        login_id: body.login_id || null,
        notes: body.notes || null,
        min_tier: body.min_tier || 'officer',
        vault_secret_id: vaultSecretId,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }

      const { error } = entryId ? await admin.from('account_directory').update(payload).eq('id', entryId) : await admin.from('account_directory').insert(payload)
      if (error) throw error

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: '不明な操作です' }), { status: 400, headers: corsHeaders })
  } catch (err) {
    console.error('account-secret error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
