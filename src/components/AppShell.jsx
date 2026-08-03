import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Bike,
  Calendar,
  FolderOpen,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  TriangleAlert,
  Users,
} from 'lucide-react'
import { supabase } from '@/supabase'
import { useProfile } from '@/hooks/useProfile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import NameConfirmDialog from '@/components/NameConfirmDialog'
import { cn } from '@/lib/utils'

const MOBILE_NAV_ITEMS = [
  { to: '/', label: 'ホーム', icon: Bike, end: true },
  { to: '/schedule', label: '予定', icon: Calendar },
  { to: '/board', label: '掲示板', icon: MessageSquare },
  { to: '/tasks', label: 'タスク', icon: ListTodo },
  { to: '/more', label: 'その他', icon: Menu },
]

const SIDEBAR_NAV_ITEMS = [
  { to: '/', label: 'ダッシュボード', icon: LayoutDashboard, end: true },
  { to: '/schedule', label: 'スケジュール', icon: Calendar },
  { to: '/tasks', label: 'タスク', icon: ListTodo },
  { to: '/board', label: 'ライブボード', icon: MessageSquare },
  { to: '/announcements', label: 'お知らせ', icon: Megaphone },
  { to: '/resources', label: '資料', icon: FolderOpen },
  { to: '/members', label: 'メンバー', icon: Users },
  { to: '/more', label: 'その他', icon: Menu },
]

function SidebarLink({ to, label, icon: Icon, end, danger }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          danger
            ? isActive
              ? 'bg-destructive/10 text-destructive'
              : 'text-destructive/80 hover:bg-destructive/10 hover:text-destructive'
            : isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )
      }
    >
      <Icon className="h-4.5 w-4.5" />
      {label}
    </NavLink>
  )
}

export default function AppShell({ user }) {
  const { data: profile } = useProfile(user?.id)
  const displayName = profile?.full_name || user?.user_metadata?.name || '部員'
  const avatarUrl = user?.user_metadata?.avatar
  const roleLabel = profile?.club_roles?.label_ja
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const isOfficerPlus = ['executive', 'officer'].includes(profile?.club_roles?.tier)
  const [backgroundUrl, setBackgroundUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function loadBackground() {
      if (!profile?.background_url) {
        setBackgroundUrl(null)
        return
      }
      const { data, error } = await supabase.storage.from('profile-backgrounds').createSignedUrl(profile.background_url, 60 * 60)
      if (!cancelled && !error) setBackgroundUrl(data.signedUrl)
    }
    loadBackground()
    return () => {
      cancelled = true
    }
  }, [profile?.background_url])

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  // Personal background (set per-user in 設定 > 背景画像). Rendered as its own
  // fixed, full-viewport layer behind everything rather than a background-*
  // on the scrolling container -- `background-attachment: fixed` doesn't
  // stay put on mobile Safari, so a separate `position: fixed` element is
  // used instead to guarantee it never scrolls with the content. Layered
  // under a background-colored scrim so cards (which stay fully opaque via
  // bg-card) remain the primary readable surface and any text sitting
  // directly on the shell keeps enough contrast.
  const backgroundStyle = backgroundUrl
    ? {
        backgroundImage: `linear-gradient(hsl(var(--background) / 0.75), hsl(var(--background) / 0.75)), url(${backgroundUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : undefined

  return (
    <>
      {profile && profile.name_confirmed === false && <NameConfirmDialog profile={profile} />}
      {backgroundUrl && <div className="fixed inset-x-0 top-0 -z-10 h-svh w-full" style={backgroundStyle} />}
      <div className="min-h-svh md:flex">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border/60 bg-card md:flex">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <div>
            <p className="text-base font-black leading-tight tracking-tight">WanderCycling</p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">University Club</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
          <SidebarLink to="/emergency" label="緊急時" icon={TriangleAlert} danger />
        </nav>

        <div className="border-t border-border/60 p-3">
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
            <Avatar className="h-9 w-9">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback>{displayName?.[0]}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{displayName}</p>
              {roleLabel && (
                <Badge variant="secondary" className="mt-0.5 text-[10px]">
                  {roleLabel}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="ログアウト" className="shrink-0">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md md:hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-black tracking-tight">WanderCycling</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" asChild aria-label="緊急連絡">
              <NavLink to="/emergency" className="text-destructive hover:bg-destructive/10">
                <TriangleAlert className="h-5 w-5" />
              </NavLink>
            </Button>
            <Avatar>
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback>{displayName?.[0]}</AvatarFallback>
            </Avatar>
            <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="ログアウト">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 md:pl-64">
        <main className="pb-20 md:pb-8">
          <Outlet context={{ user, profile, isOfficerPlus, isExecutive }} />
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/95 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-5">
          {MOBILE_NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      </div>
    </>
  )
}
