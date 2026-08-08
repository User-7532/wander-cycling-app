import { Suspense, lazy, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/supabase'
import AppShell from '@/components/AppShell'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import AuthCallback from '@/pages/AuthCallback'

// Lazy-loaded: every page beyond the login/home landing path, so a member
// only downloads the code for pages they actually visit instead of the
// whole app's JS up front.
const Schedule = lazy(() => import('@/pages/Schedule'))
const Announcements = lazy(() => import('@/pages/Announcements'))
const Tasks = lazy(() => import('@/pages/Tasks'))
const StatusBoard = lazy(() => import('@/pages/StatusBoard'))
const Members = lazy(() => import('@/pages/Members'))
const Attributes = lazy(() => import('@/pages/Attributes'))
const Emergency = lazy(() => import('@/pages/Emergency'))
const Settings = lazy(() => import('@/pages/Settings'))
const Finance = lazy(() => import('@/pages/Finance'))
const PersonalExpenses = lazy(() => import('@/pages/PersonalExpenses'))
const Resources = lazy(() => import('@/pages/Resources'))
const AccountDirectory = lazy(() => import('@/pages/AccountDirectory'))
const SiteMap = lazy(() => import('@/pages/SiteMap'))
const More = lazy(() => import('@/pages/More'))

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
    <Suspense fallback={<Splash />}>
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
            <Route path="/settings" element={<Settings />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/expenses" element={<PersonalExpenses />} />
            <Route path="/accounts" element={<AccountDirectory />} />
            <Route path="/sitemap" element={<SiteMap />} />
            <Route path="/more" element={<More />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </Suspense>
  )
}

export default App
