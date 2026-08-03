import { motion } from 'framer-motion'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function Login() {
  function handleLineLogin() {
    const lineAuthUrl = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${
      import.meta.env.VITE_LINE_CHANNEL_ID
    }&redirect_uri=${encodeURIComponent(
      `${window.location.origin}/auth/callback`
    )}&state=wandercycling&scope=profile%20openid`
    window.location.href = lineAuthUrl
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
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-black tracking-tight">WanderCycling</h1>
            <p className="mt-1 text-sm text-muted-foreground">ポータルサイトへようこそ</p>
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
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">ワンダーサイクリング同好会 部内システム</p>
      </motion.div>
    </div>
  )
}
