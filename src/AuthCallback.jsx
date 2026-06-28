import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

function AuthCallback({ onLogin }) {
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    async function handleCallback() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      if (!code) return

      const { data, error } = await supabase.functions.invoke('line-auth', {
        body: { code }
      })

      console.log('レスポンス:', data, error)

      if (error || !data?.url) {
        console.error('LINEログイン失敗', error)
        return
      }

      const urlObj = new URL(data.url)
      const token = urlObj.searchParams.get('token')
      const type = urlObj.searchParams.get('type')
      console.log('token:', token, 'type:', type)

      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: 'magiclink'
      })
      console.log('セッション確立:', sessionError ? sessionError.message : 'OK')

      if (!sessionError) {
        console.log('onLogin呼び出し！')
        onLogin()
      }
    }

    handleCallback()
  }, [])

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p>ログイン中...</p>
    </div>
  )
}

export default AuthCallback