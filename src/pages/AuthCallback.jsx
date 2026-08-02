import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/supabase'

export default function AuthCallback() {
  const called = useRef(false)
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (called.current) return
    called.current = true

    async function handleCallback() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      if (!code) {
        setErrorMessage('LINEからの認証コードが見つかりませんでした。')
        return
      }

      // Must exactly match the redirect_uri used in the authorize request
      // (Login.jsx), since LINE's token endpoint requires it — send it
      // through explicitly instead of hardcoding one origin server-side, so
      // login works from localhost during development and from the deployed
      // domain in production without swapping secrets.
      const { data, error } = await supabase.functions.invoke('line-auth', {
        body: { code, redirect_uri: `${window.location.origin}/auth/callback` },
      })

      if (error || !data?.url) {
        setErrorMessage('LINEログインに失敗しました。もう一度お試しください。')
        return
      }

      const urlObj = new URL(data.url)
      const token = urlObj.searchParams.get('token')
      const type = urlObj.searchParams.get('type')

      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: type || 'magiclink',
      })

      if (sessionError) {
        setErrorMessage('セッションの確立に失敗しました。もう一度お試しください。')
        return
      }

      navigate('/', { replace: true })
    }

    handleCallback()
  }, [navigate])

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-3 text-center"
      >
        {errorMessage ? (
          <>
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <a href="/" className="text-sm font-medium text-primary underline underline-offset-4">
              ログイン画面に戻る
            </a>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">ログイン中...</p>
          </>
        )}
      </motion.div>
    </div>
  )
}
