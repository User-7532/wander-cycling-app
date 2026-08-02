import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { useOutletContext, Link } from 'react-router-dom'
import { Calendar, ListTodo, MapPin, Megaphone, TriangleAlert } from 'lucide-react'
import { supabase } from '@/supabase'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' })
}

function greeting() {
  const h = new Date().getHours()
  if (h < 11) return 'おはようございます'
  if (h < 18) return 'こんにちは'
  return 'こんばんは'
}

function StatTile({ icon: Icon, value, label, to }) {
  return (
    <Link to={to}>
      <Card className="p-5 transition-colors hover:border-primary/40 hover:bg-primary/5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <p className="text-2xl font-black tracking-tight">{value ?? '–'}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </Card>
    </Link>
  )
}

export default function Home() {
  const { user, profile, isExecutive } = useOutletContext()
  const displayName = profile?.full_name || user?.user_metadata?.name || '部員'
  const roleLabel = profile?.club_roles?.label_ja

  const today = new Date().toISOString().slice(0, 10)

  const { data: events, isLoading: eventsLoading } = useQuery({
    queryKey: ['club_events', 'upcoming', 'home'],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('club_events')
        .select('id, title, start_date, end_date, location, category', { count: 'exact' })
        .gte('start_date', today)
        .order('start_date', { ascending: true })
        .limit(3)
      if (error) throw error
      return { rows: data, count }
    },
  })

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', 'mine', 'home'],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('tasks')
        .select('id, title, due_date, priority', { count: 'exact' })
        .eq('assigned_to', user.id)
        .neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(3)
      if (error) throw error
      return { rows: data, count }
    },
    enabled: !!user,
  })

  const { data: announcements, isLoading: announcementsLoading } = useQuery({
    queryKey: ['announcements', 'home'],
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from('announcements')
        .select('id, title, body, pinned, created_at', { count: 'exact' })
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(2)
      if (error) throw error
      return { rows: data, count }
    },
  })

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-8 text-primary-foreground"
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 right-24 h-32 w-32 rounded-full bg-white/10" />
        <p className="text-sm text-white/80">{greeting()}、</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">{displayName}さん</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {roleLabel && <Badge className="border-none bg-white/20 text-white hover:bg-white/20">{roleLabel}</Badge>}
          {isExecutive && <Badge className="border-none bg-white/20 text-white hover:bg-white/20">役員</Badge>}
        </div>
      </motion.div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatTile icon={Calendar} value={events?.count} label="直近のイベント" to="/schedule" />
        <StatTile icon={ListTodo} value={tasks?.count} label="自分のタスク" to="/tasks" />
        <StatTile icon={Megaphone} value={announcements?.count} label="お知らせ" to="/announcements" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">今後のスケジュール</h2>
            <Link to="/schedule" className="text-xs font-medium text-primary hover:underline">
              すべて見る
            </Link>
          </div>
          {eventsLoading && <Skeleton className="h-24 w-full" />}
          {!eventsLoading && (!events?.rows || events.rows.length === 0) && (
            <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">予定はまだ登録されていません</Card>
          )}
          <div className="space-y-3">
            {events?.rows?.map((e) => (
              <Card key={e.id} className="flex gap-3 overflow-hidden p-0">
                <div className="w-1.5 shrink-0 bg-primary" />
                <div className="flex-1 py-3.5 pr-4">
                  <p className="font-bold">{e.title}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {e.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {e.location}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(e.start_date)}
                    </span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">マイタスク</h2>
              <Link to="/tasks" className="text-xs font-medium text-primary hover:underline">
                すべて見る
              </Link>
            </div>
            {tasksLoading && <Skeleton className="h-16 w-full" />}
            {!tasksLoading && (!tasks?.rows || tasks.rows.length === 0) && (
              <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">タスクはありません</Card>
            )}
            <div className="space-y-2">
              {tasks?.rows?.map((t) => (
                <Card key={t.id} className="flex items-center justify-between px-4 py-3">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.due_date && <span className="shrink-0 text-xs text-muted-foreground">{t.due_date}</span>}
                </Card>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">最新のお知らせ</h2>
              <Link to="/announcements" className="text-xs font-medium text-primary hover:underline">
                すべて見る
              </Link>
            </div>
            {announcementsLoading && <Skeleton className="h-20 w-full" />}
            <div className="space-y-2">
              {announcements?.rows?.map((a) => (
                <Card key={a.id} className={a.pinned ? 'border-accent/50 bg-accent/5 p-4' : 'p-4'}>
                  <div className="mb-1 flex items-center gap-2">
                    {a.pinned && (
                      <Badge variant="outline" className="border-accent text-accent-foreground">
                        固定
                      </Badge>
                    )}
                    <p className="font-bold">{a.title}</p>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                </Card>
              ))}
            </div>
          </div>

          <Link to="/emergency">
            <Card className="flex items-center gap-3 border-destructive/30 bg-destructive/5 p-4 transition-colors hover:bg-destructive/10">
              <TriangleAlert className="h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-bold text-destructive">緊急時ページ</p>
                <p className="text-xs text-muted-foreground">いざという時の手順・連絡先</p>
              </div>
            </Card>
          </Link>
        </section>
      </div>
    </div>
  )
}
