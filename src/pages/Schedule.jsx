import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Calendar, Clock, Link2, MapPin, Paperclip, Pencil, Plus, Search, Trash2, Users, UserRoundCheck } from 'lucide-react'
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
import { cn } from '@/lib/utils'

const VISIBILITY_LABEL = { all: '全員', invite_only: '有志' }

const CATEGORY_LABEL = {
  gasshuku: '合宿',
  practice: '練習',
  event: 'イベント',
  meeting: 'ミーティング',
  competition: '大会',
  other: 'その他',
}

const CATEGORY_COLOR = {
  gasshuku: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  practice: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  event: 'bg-violet-100 text-violet-700 hover:bg-violet-100',
  meeting: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  competition: 'bg-rose-100 text-rose-700 hover:bg-rose-100',
  other: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
}

function dateBoxParts(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { month: '', day: '' }
  return { month: d.toLocaleDateString('ja-JP', { month: 'short' }), day: d.getDate() }
}

// Convert a stored UTC ISO timestamp into the "YYYY-MM-DDTHH:mm" format
// expected by <input type="datetime-local">, in the browser's local time.
function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function formatDateTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatEndTime(startValue, endValue) {
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (Number.isNaN(end.getTime())) return ''
  const sameDay = start.toDateString() === end.toDateString()
  return sameDay
    ? end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
    : end.toLocaleString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

const RSVP_OPTIONS = [
  { value: 'attending', label: '参加' },
  { value: 'undecided', label: '未定' },
  { value: 'not_attending', label: '不参加' },
]

const EMPTY_FORM = { title: '', description: '', start_at: '', end_at: '', location: '', category: 'practice', visibility: 'all', inviteeIds: [], link: '' }

function EventAttachmentLink({ path }) {
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    const { data, error } = await supabase.storage.from('event-attachments').createSignedUrl(path, 60)
    setLoading(false)
    if (error) {
      toast.error('添付ファイルの取得に失敗しました')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <button type="button" onClick={open} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      <Paperclip className="h-3.5 w-3.5" />
      添付ファイルを見る
    </button>
  )
}

function EventFormDialog({ mode, event, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(
    mode === 'edit'
      ? {
          title: event.title,
          description: event.description || '',
          start_at: toLocalInput(event.start_at),
          end_at: toLocalInput(event.end_at),
          location: event.location || '',
          category: CATEGORY_LABEL[event.category] ? event.category : 'other',
          visibility: event.visibility,
          inviteeIds: [],
          link: event.link || '',
        }
      : EMPTY_FORM
  )
  const [customCategory, setCustomCategory] = useState(
    mode === 'edit' && event.category && !CATEGORY_LABEL[event.category] ? event.category : ''
  )
  const [file, setFile] = useState(null)
  const [removeAttachment, setRemoveAttachment] = useState(false)
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
      const finalCategory = form.category === 'other' && customCategory.trim() ? customCategory.trim() : form.category
      const eventId = mode === 'edit' ? event.id : crypto.randomUUID()

      // Resolve the attachment: keep existing, remove, or upload a replacement.
      let attachmentPath = mode === 'edit' ? event.attachment_path ?? null : null
      if (removeAttachment) attachmentPath = null
      if (file) {
        attachmentPath = `${eventId}/${file.name}`
        const { error: uploadError } = await supabase.storage.from('event-attachments').upload(attachmentPath, file, { upsert: true })
        if (uploadError) throw uploadError
      }
      if (mode === 'edit' && event.attachment_path && event.attachment_path !== attachmentPath) {
        await supabase.storage.from('event-attachments').remove([event.attachment_path])
      }

      const payload = {
        title: form.title,
        description: form.description || null,
        start_at: form.start_at ? new Date(form.start_at).toISOString() : null,
        end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
        location: form.location || null,
        category: finalCategory,
        visibility: form.visibility,
        link: form.link || null,
        attachment_path: attachmentPath,
      }

      if (mode === 'edit') {
        const { error } = await supabase.from('club_events').update(payload).eq('id', eventId)
        if (error) throw error
        await supabase.from('event_invitees').delete().eq('event_id', eventId)
      } else {
        const { error } = await supabase.from('club_events').insert({ id: eventId, ...payload })
        if (error) throw error
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
      if (mode === 'create') {
        setForm(EMPTY_FORM)
        setCustomCategory('')
        setFile(null)
        setRemoveAttachment(false)
      }
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="start_at">集合時間</Label>
              <Input id="start_at" type="datetime-local" required value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_at">終了日時（任意）</Label>
              <Input id="end_at" type="datetime-local" value={form.end_at} onChange={(e) => setForm({ ...form, end_at: e.target.value })} />
              <p className="text-xs text-muted-foreground">空欄の場合は終日予定になります</p>
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
            {form.category === 'other' && (
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="カテゴリ名を入力"
                className="mt-1.5"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">詳細</Label>
            <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link">リンク（任意）</Label>
            <Input id="link" type="url" placeholder="https://" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attachment">添付ファイル（任意）</Label>
            {mode === 'edit' && event.attachment_path && !removeAttachment && !file && (
              <div className="flex items-center justify-between rounded-xl border border-input px-3 py-2">
                <EventAttachmentLink path={event.attachment_path} />
                <button type="button" onClick={() => setRemoveAttachment(true)} className="text-xs text-muted-foreground hover:text-destructive">
                  削除
                </button>
              </div>
            )}
            {removeAttachment && !file && (
              <p className="text-xs text-muted-foreground">保存すると添付ファイルが削除されます</p>
            )}
            <label
              htmlFor="attachment"
              className="flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input text-xs text-muted-foreground hover:bg-muted/50"
            >
              <Paperclip className="h-4 w-4" />
              {file ? file.name : 'タップしてファイルを選択'}
            </label>
            <input
              id="attachment"
              type="file"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setRemoveAttachment(false)
              }}
            />
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
  const [search, setSearch] = useState('')
  const [timeFilter, setTimeFilter] = useState('upcoming')

  const { data: events, isLoading } = useQuery({
    queryKey: ['club_events'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_events').select('*').order('start_at', { ascending: true })
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

  const now = new Date()
  const filteredEvents = events
    ?.filter((e) => {
      if (timeFilter === 'upcoming') return new Date(e.start_at) >= now
      if (timeFilter === 'past') return new Date(e.start_at) < now
      return true
    })
    .filter((e) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return e.title?.toLowerCase().includes(q) || e.location?.toLowerCase().includes(q)
    })

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">スケジュール</h1>
        {isExecutive && (
          <EventFormDialog
            mode="create"
            open={createOpen}
            onOpenChange={setCreateOpen}
            trigger={
              <Button size="sm" className="rounded-full">
                <Plus className="h-4 w-4" />
                イベント追加
              </Button>
            }
          />
        )}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">クラブのイベント・練習予定を確認・参加登録できます</p>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="タイトル・場所で検索..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={timeFilter} onValueChange={setTimeFilter}>
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upcoming">今後の予定</SelectItem>
            <SelectItem value="past">過去の予定</SelectItem>
            <SelectItem value="all">すべて</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!isLoading && (!filteredEvents || filteredEvents.length === 0) && (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <Calendar className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">該当する予定はありません</p>
        </Card>
      )}

      <div className="space-y-3">
        {filteredEvents?.map((e, i) => {
          const selected = myStatus(e.id)
          const { month, day } = dateBoxParts(e.start_at)
          return (
            <motion.div key={e.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(i, 5) * 0.03 }}>
              <Card className="p-5">
                <div className="flex gap-4">
                  <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <span className="text-xs font-medium">{month}</span>
                    <span className="text-2xl font-black leading-none">{day}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h3 className="font-bold">{e.title}</h3>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {!e.end_at && (
                          <Badge variant="outline" className="gap-1">
                            <Clock className="h-3 w-3" />
                            終日
                          </Badge>
                        )}
                        {e.visibility === 'invite_only' && (
                          <Badge variant="secondary" className="gap-1">
                            <UserRoundCheck className="h-3 w-3" />
                            {VISIBILITY_LABEL.invite_only}
                          </Badge>
                        )}
                        <Badge className={cn('border-none', CATEGORY_COLOR[e.category] || CATEGORY_COLOR.other)}>
                          {CATEGORY_LABEL[e.category] || e.category}
                        </Badge>
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
                    {e.description && <p className="mb-1.5 text-sm text-muted-foreground">{e.description}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {e.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {e.location}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDateTime(e.start_at)}
                        {e.end_at ? ` 〜 ${formatEndTime(e.start_at, e.end_at)}` : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" />
                        参加 {attendingCount(e.id)}人
                      </span>
                    </div>
                    {(e.link || e.attachment_path) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-3">
                        {e.link && (
                          <a href={e.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                            <Link2 className="h-3.5 w-3.5" />
                            リンクを開く
                          </a>
                        )}
                        {e.attachment_path && <EventAttachmentLink path={e.attachment_path} />}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
              <div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                参加登録:
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
            </motion.div>
          )
        })}
      </div>

      {editing && <EventFormDialog mode="edit" event={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  )
}
