import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Calendar, MapPin, Pencil, Plus, Trash2, Users, UserRoundCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const VISIBILITY_LABEL = { all: '全員', invite_only: '有志' }

const CATEGORY_LABEL = {
  gasshuku: '合宿',
  practice: '練習',
  event: 'イベント',
  meeting: 'ミーティング',
  competition: '大会',
  other: 'その他',
}

const RSVP_OPTIONS = [
  { value: 'attending', label: '参加' },
  { value: 'undecided', label: '未定' },
  { value: 'not_attending', label: '不参加' },
]

const EMPTY_FORM = { title: '', description: '', start_date: '', end_date: '', location: '', category: 'practice', visibility: 'all', inviteeIds: [] }

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' })
}

function EventFormDialog({ mode, event, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(
    mode === 'edit'
      ? {
          title: event.title,
          description: event.description || '',
          start_date: event.start_date,
          end_date: event.end_date || '',
          location: event.location || '',
          category: event.category,
          visibility: event.visibility,
          inviteeIds: [],
        }
      : EMPTY_FORM
  )
  const queryClient = useQueryClient()

  const { data: members } = useQuery({
    queryKey: ['profiles', 'for-invite'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return data
    },
    enabled: open && form.visibility === 'invite_only',
  })

  const { data: existingInvitees } = useQuery({
    queryKey: ['event_invitees', event?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_invitees').select('profile_id').eq('event_id', event.id)
      if (error) throw error
      return data.map((r) => r.profile_id)
    },
    enabled: mode === 'edit' && open && event.visibility === 'invite_only',
  })

  useEffect(() => {
    if (existingInvitees) setForm((f) => ({ ...f, inviteeIds: existingInvitees }))
  }, [existingInvitees])

  function toggleInvitee(id) {
    setForm((f) => ({
      ...f,
      inviteeIds: f.inviteeIds.includes(id) ? f.inviteeIds.filter((x) => x !== id) : [...f.inviteeIds, id],
    }))
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description || null,
        start_date: form.start_date,
        end_date: form.end_date || null,
        location: form.location || null,
        category: form.category,
        visibility: form.visibility,
      }

      let eventId = event?.id
      if (mode === 'edit') {
        const { error } = await supabase.from('club_events').update(payload).eq('id', eventId)
        if (error) throw error
        await supabase.from('event_invitees').delete().eq('event_id', eventId)
      } else {
        const { data: created, error } = await supabase.from('club_events').insert(payload).select('id').single()
        if (error) throw error
        eventId = created.id
      }

      if (form.visibility === 'invite_only' && form.inviteeIds.length > 0) {
        const { error: inviteError } = await supabase.from('event_invitees').insert(form.inviteeIds.map((profile_id) => ({ event_id: eventId, profile_id })))
        if (inviteError) throw inviteError
      }
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : '予定を追加しました')
      queryClient.invalidateQueries({ queryKey: ['club_events'] })
      queryClient.invalidateQueries({ queryKey: ['event_invitees'] })
      if (mode === 'create') setForm(EMPTY_FORM)
      onOpenChange(false)
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? '予定を編集' : '予定を追加'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="title">タイトル</Label>
            <Input id="title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start_date">開始日</Label>
              <Input id="start_date" type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_date">終了日</Label>
              <Input id="end_date" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">場所</Label>
            <Input id="location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>カテゴリ</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">詳細</Label>
            <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>公開範囲</Label>
            <Select value={form.visibility} onValueChange={(v) => setForm({ ...form, visibility: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全員に表示</SelectItem>
                <SelectItem value="invite_only">有志のみ（メンバーを選択）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.visibility === 'invite_only' && (
            <div className="space-y-1.5">
              <Label>参加できるメンバー</Label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-input p-2">
                {members?.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={form.inviteeIds.includes(m.id)}
                      onChange={() => toggleInvitee(m.id)}
                      className="h-4 w-4 rounded"
                    />
                    {m.full_name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {mode === 'edit' ? '保存する' : '追加する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Schedule() {
  const { user, profile } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: events, isLoading } = useQuery({
    queryKey: ['club_events'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_events').select('*').order('start_date', { ascending: true })
      if (error) throw error
      return data
    },
  })

  const { data: registrations } = useQuery({
    queryKey: ['event_registrations', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_registrations').select('event_id, profile_id, status')
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  const rsvp = useMutation({
    mutationFn: async ({ eventId, status }) => {
      const { error } = await supabase
        .from('event_registrations')
        .upsert({ event_id: eventId, profile_id: user.id, status }, { onConflict: 'event_id,profile_id' })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event_registrations'] }),
    onError: (err) => toast.error(`回答に失敗しました: ${err.message}`),
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('club_events').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['club_events'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  function attendingCount(eventId) {
    return registrations?.filter((r) => r.event_id === eventId && r.status === 'attending').length || 0
  }
  function myStatus(eventId) {
    return registrations?.find((r) => r.event_id === eventId && r.profile_id === user?.id)?.status
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">予定</h1>
        {isExecutive && (
          <EventFormDialog
            mode="create"
            open={createOpen}
            onOpenChange={setCreateOpen}
            trigger={
              <Button size="icon" className="h-10 w-10 rounded-full">
                <Plus className="h-5 w-5" />
              </Button>
            }
          />
        )}
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!isLoading && (!events || events.length === 0) && (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <Calendar className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">予定はまだ登録されていません</p>
        </Card>
      )}

      <div className="space-y-3">
        {events?.map((e, i) => {
          const selected = myStatus(e.id)
          return (
            <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(i, 5) * 0.03 }}>
              <Card className="p-5">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-bold">{e.title}</h3>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {e.visibility === 'invite_only' && (
                      <Badge variant="secondary" className="gap-1">
                        <UserRoundCheck className="h-3 w-3" />
                        {VISIBILITY_LABEL.invite_only}
                      </Badge>
                    )}
                    <Badge variant="outline">{CATEGORY_LABEL[e.category] || e.category}</Badge>
                    {isExecutive && (
                      <>
                        <button onClick={() => setEditing(e)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('この予定を削除しますか？')) remove.mutate(e.id)
                          }}
                          className="text-muted-foreground transition-colors hover:text-destructive"
                          aria-label="削除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {e.description && <p className="mb-2 text-sm text-muted-foreground">{e.description}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {e.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {e.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(e.start_date)}
                    {e.end_date && e.end_date !== e.start_date ? ` 〜 ${formatDate(e.end_date)}` : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    参加 {attendingCount(e.id)}人
                  </span>
                </div>
                <div className="mt-4 flex gap-2">
                  {RSVP_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      type="button"
                      size="sm"
                      variant={selected === opt.value ? 'default' : 'outline'}
                      onClick={() => rsvp.mutate({ eventId: e.id, status: opt.value })}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {editing && <EventFormDialog mode="edit" event={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  )
}
