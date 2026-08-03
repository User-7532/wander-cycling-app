import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/supabase'
import AppShell from '@/components/AppShell'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import Schedule from '@/pages/Schedule'
import Announcements from '@/pages/Announcements'
import Tasks from '@/pages/Tasks'
import StatusBoard from '@/pages/StatusBoard'
import Members from '@/pages/Members'
import Attributes from '@/pages/Attributes'
import Emergency from '@/pages/Emergency'
import Settings from '@/pages/Settings'
import Finance from '@/pages/Finance'
import Resources from '@/pages/Resources'
import AccountDirectory from '@/pages/AccountDirectory'
import Management from '@/pages/Management'
import SiteMap from '@/pages/SiteMap'
import More from '@/pages/More'
import AuthCallback from '@/pages/AuthCallback'

function Splash() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) return <Splash />

  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      {!session ? (
        <Route path="*" element={<Login />} />
      ) : (
        <Route element={<AppShell user={session.user} />}>
          <Route path="/" element={<Home />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/board" element={<StatusBoard />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/members" element={<Members />} />
          <Route path="/attributes" element={<Attributes />} />
          <Route path="/emergency" element={<Emergency />} />
          <Route path="/management" element={<Management />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/accounts" element={<AccountDirectory />} />
          <Route path="/sitemap" element={<SiteMap />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  )
}

export default App
