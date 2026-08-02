import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bike, MessageCircle, ChevronDown, Loader2 } from 'lucide-react'
import { supabase } from '@/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Login() {
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleLineLogin() {
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${
      import.meta.env.VITE_LINE_CHANNEL_ID
    }&redirect_uri=${encodeURIComponent(
      `${window.location.origin}/auth/callback`
    )}&state=wandercycling&scope=profile%20openid`
    window.location.href = lineAuthUrl
  }

  async function handleEmailLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError('メールアドレスかパスワードが違います。')
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden px-4 py-12">
      {/* decorative background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-secondary/60 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <div className="rounded-3xl border border-white/60 bg-card/90 p-8 shadow-xl shadow-primary/5 backdrop-blur-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <Bike className="h-7 w-7" />
          </div>

          <div className="mb-8 text-center">
            <h1 className="text-2xl font-black tracking-tight">WanderCycling</h1>
            <p className="mt-1 text-sm text-muted-foreground">部員専用ポータルへようこそ</p>
          </div>

          <Button
            type="button"
            variant="line"
            size="lg"
            onClick={handleLineLogin}
            className="w-full"
          >
            <MessageCircle className="h-5 w-5" />
            LINEでログイン
          </Button>

          <button
            type="button"
            onClick={() => setShowEmailForm((v) => !v)}
            className="mx-auto mt-6 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            メールアドレスでログイン
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showEmailForm ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence initial={false}>
            {showEmailForm && (
              <motion.form
                onSubmit={handleEmailLogin}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="mt-5 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">メールアドレス</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">パスワード</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" variant="secondary" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ログイン'}
                  </Button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">WanderCycling 部内システム</p>
      </motion.div>
    </div>
  )
}
