import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useOutletContext } from 'react-router-dom'
import { Calendar, CalendarClock, ChevronDown, Clock, Link2, MapPin, Paperclip, Pencil, Plus, RefreshCw, Search, Trash2, Users, UserRoundCheck } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { safeStorageFilename } from '@/lib/storage'
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
  event: 'イベント',
  meeting: 'ミーティング',
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

const EMPTY_FORM = {
  title: '',
  description: '',
  start_at: '',
  end_at: '',
  location: '',
  category: 'practice',
  visibility: 'all',
  inviteeIds: [],
  link: '',
  rsvpDeadlineEnabled: false,
  rsvp_deadline: '',
  rsvpRestricted: false,
  rsvpViewerIds: [],
}

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
          rsvpDeadlineEnabled: !!event.rsvp_deadline,
          rsvp_deadline: toLocalInput(event.rsvp_deadline),
          rsvpRestricted: event.rsvp_visibility === 'restricted',
          rsvpViewerIds: [],
        }
      : EMPTY_FORM
  )
  const [filterAttrId, setFilterAttrId] = useState('')
  const [filterValueId, setFilterValueId] = useState('')
  const [filterRoleId, setFilterRoleId] = useState('')
  const [rsvpFilterAttrId, setRsvpFilterAttrId] = useState('')
  const [rsvpFilterValueId, setRsvpFilterValueId] = useState('')
  const [rsvpFilterRoleId, setRsvpFilterRoleId] = useState('')
  // "Standing" targets: instead of resolving the filter to today's matching
  // profiles, remember the attribute value / role itself so membership stays
  // live (see 0064_dynamic_group_targets.sql). Parallel to inviteeIds /
  // rsvpViewerIds, not a replacement -- all kinds of rows go into the same
  // event_invitees / event_rsvp_viewers tables.
  const [standingAttributeValueIds, setStandingAttributeValueIds] = useState([])
  const [standingRoleIds, setStandingRoleIds] = useState([])
  const [rsvpStandingAttributeValueIds, setRsvpStandingAttributeValueIds] = useState([])
  const [rsvpStandingRoleIds, setRsvpStandingRoleIds] = useState([])
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
    enabled: open && (form.visibility === 'invite_only' || form.rsvpRestricted),
  })

  const { data: existingInvitees } = useQuery({
    queryKey: ['event_invitees', event?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_invitees').select('profile_id, attribute_value_id, club_role_id').eq('event_id', event.id)
      if (error) throw error
      return data
    },
    enabled: mode === 'edit' && open && event.visibility === 'invite_only',
  })

  useEffect(() => {
    if (!existingInvitees) return
    setForm((f) => ({ ...f, inviteeIds: existingInvitees.filter((r) => r.profile_id).map((r) => r.profile_id) }))
    setStandingAttributeValueIds(existingInvitees.filter((r) => r.attribute_value_id).map((r) => r.attribute_value_id))
    setStandingRoleIds(existingInvitees.filter((r) => r.club_role_id).map((r) => r.club_role_id))
  }, [existingInvitees])

  const { data: existingRsvpViewers } = useQuery({
    queryKey: ['event_rsvp_viewers', event?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_rsvp_viewers').select('profile_id, attribute_value_id, club_role_id').eq('event_id', event.id)
      if (error) throw error
      return data
    },
    enabled: mode === 'edit' && open && event.rsvp_visibility === 'restricted',
  })

  useEffect(() => {
    if (!existingRsvpViewers) return
    setForm((f) => ({ ...f, rsvpViewerIds: existingRsvpViewers.filter((r) => r.profile_id).map((r) => r.profile_id) }))
    setRsvpStandingAttributeValueIds(existingRsvpViewers.filter((r) => r.attribute_value_id).map((r) => r.attribute_value_id))
    setRsvpStandingRoleIds(existingRsvpViewers.filter((r) => r.club_role_id).map((r) => r.club_role_id))
  }, [existingRsvpViewers])

  // Attribute-based bulk selection: pick an attribute + value, then flip
  // (toggle) everyone tagged with that value in the invitee checklist at
  // once -- anyone already selected in that matched group gets deselected,
  // and anyone not yet selected gets selected. This lets combos like
  // "select all, then flip off 3年" work. The manual checklist below still
  // lets the user add/remove individuals afterward.
  const { data: attributes } = useQuery({
    queryKey: ['member_attributes', 'for-invite-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attributes').select('id, label').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: open && (form.visibility === 'invite_only' || form.rsvpRestricted),
  })

  const { data: attributeValues } = useQuery({
    queryKey: ['member_attribute_values', filterAttrId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_attribute_values')
        .select('id, value')
        .eq('attribute_id', filterAttrId)
        .order('sort_order')
      if (error) throw error
      return data
    },
    enabled: !!filterAttrId,
  })

  const { data: rsvpAttributeValues } = useQuery({
    queryKey: ['member_attribute_values', rsvpFilterAttrId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_attribute_values')
        .select('id, value')
        .eq('attribute_id', rsvpFilterAttrId)
        .order('sort_order')
      if (error) throw error
      return data
    },
    enabled: !!rsvpFilterAttrId,
  })

  // Label lookups for standing-target chips: standing*AttributeValueIds can
  // span attributes other than the one currently selected in the filter
  // above, so they need their own by-id fetch rather than reusing
  // attributeValues/rsvpAttributeValues.
  const { data: standingAttributeValueLabels } = useQuery({
    queryKey: ['member_attribute_values', 'standing-labels', standingAttributeValueIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').in('id', standingAttributeValueIds)
      if (error) throw error
      return data
    },
    enabled: standingAttributeValueIds.length > 0,
  })

  const { data: rsvpStandingAttributeValueLabels } = useQuery({
    queryKey: ['member_attribute_values', 'rsvp-standing-labels', rsvpStandingAttributeValueIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').in('id', rsvpStandingAttributeValueIds)
      if (error) throw error
      return data
    },
    enabled: rsvpStandingAttributeValueIds.length > 0,
  })

  // Role-based bulk selection (same XOR-toggle pattern as the attribute
  // filters above, but resolved via profile_roles instead of
  // profile_attribute_values). Shared between the invitee and
  // RSVP-viewer pickers, same as `attributes` above.
  const { data: clubRoles } = useQuery({
    queryKey: ['club_roles', 'for-invite-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('id, label_ja').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: open && (form.visibility === 'invite_only' || form.rsvpRestricted),
  })

  async function applyAttributeFilter() {
    if (!filterValueId) return
    const { data, error } = await supabase
      .from('profile_attribute_values')
      .select('profile_id')
      .eq('attribute_value_id', filterValueId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(form.inviteeIds)
    let added = 0
    let removed = 0
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id)
        removed++
      } else {
        next.add(id)
        added++
      }
    }
    setForm((f) => ({ ...f, inviteeIds: Array.from(next) }))
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }

  async function applyRoleFilter() {
    if (!filterRoleId) return
    const { data, error } = await supabase.from('profile_roles').select('profile_id').eq('club_role_id', filterRoleId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(form.inviteeIds)
    let added = 0
    let removed = 0
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id)
        removed++
      } else {
        next.add(id)
        added++
      }
    }
    setForm((f) => ({ ...f, inviteeIds: Array.from(next) }))
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }

  // Adds/removes the currently-selected attribute value or role itself as a
  // standing target, reusing the same filterValueId/filterRoleId selection
  // as the flip-toggle above -- no profile resolution, just remembering the id.
  function toggleStandingAttributeValue() {
    if (!filterValueId) return
    setStandingAttributeValueIds((prev) => (prev.includes(filterValueId) ? prev.filter((x) => x !== filterValueId) : [...prev, filterValueId]))
  }

  function toggleStandingRole() {
    if (!filterRoleId) return
    const roleId = Number(filterRoleId)
    setStandingRoleIds((prev) => (prev.includes(roleId) ? prev.filter((x) => x !== roleId) : [...prev, roleId]))
  }

  function toggleInvitee(id) {
    setForm((f) => ({
      ...f,
      inviteeIds: f.inviteeIds.includes(id) ? f.inviteeIds.filter((x) => x !== id) : [...f.inviteeIds, id],
    }))
  }

  function selectAllInvitees() {
    setForm((f) => ({ ...f, inviteeIds: (members || []).map((m) => m.id) }))
  }

  function deselectAllInvitees() {
    setForm((f) => ({ ...f, inviteeIds: [] }))
  }

  // Same attribute-filter-flip + manual checklist pattern as the invitee
  // picker above, but building the event_rsvp_viewers list instead.
  async function applyRsvpAttributeFilter() {
    if (!rsvpFilterValueId) return
    const { data, error } = await supabase
      .from('profile_attribute_values')
      .select('profile_id')
      .eq('attribute_value_id', rsvpFilterValueId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(form.rsvpViewerIds)
    let added = 0
    let removed = 0
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id)
        removed++
      } else {
        next.add(id)
        added++
      }
    }
    setForm((f) => ({ ...f, rsvpViewerIds: Array.from(next) }))
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }

  async function applyRsvpRoleFilter() {
    if (!rsvpFilterRoleId) return
    const { data, error } = await supabase.from('profile_roles').select('profile_id').eq('club_role_id', rsvpFilterRoleId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(form.rsvpViewerIds)
    let added = 0
    let removed = 0
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id)
        removed++
      } else {
        next.add(id)
        added++
      }
    }
    setForm((f) => ({ ...f, rsvpViewerIds: Array.from(next) }))
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }

  // Same standing-target toggle as above, but for the RSVP-viewer picker.
  function toggleRsvpStandingAttributeValue() {
    if (!rsvpFilterValueId) return
    setRsvpStandingAttributeValueIds((prev) =>
      prev.includes(rsvpFilterValueId) ? prev.filter((x) => x !== rsvpFilterValueId) : [...prev, rsvpFilterValueId]
    )
  }

  function toggleRsvpStandingRole() {
    if (!rsvpFilterRoleId) return
    const roleId = Number(rsvpFilterRoleId)
    setRsvpStandingRoleIds((prev) => (prev.includes(roleId) ? prev.filter((x) => x !== roleId) : [...prev, roleId]))
  }

  function toggleRsvpViewer(id) {
    setForm((f) => ({
      ...f,
      rsvpViewerIds: f.rsvpViewerIds.includes(id) ? f.rsvpViewerIds.filter((x) => x !== id) : [...f.rsvpViewerIds, id],
    }))
  }

  function selectAllRsvpViewers() {
    setForm((f) => ({ ...f, rsvpViewerIds: (members || []).map((m) => m.id) }))
  }

  function deselectAllRsvpViewers() {
    setForm((f) => ({ ...f, rsvpViewerIds: [] }))
  }

  const save = useMutation({
    mutationFn: async () => {
      const finalCategory = form.category === 'other' && customCategory.trim() ? customCategory.trim() : form.category
      const eventId = mode === 'edit' ? event.id : crypto.randomUUID()

      // Resolve the attachment: keep existing, remove, or upload a replacement.
      let attachmentPath = mode === 'edit' ? event.attachment_path ?? null : null
      if (removeAttachment) attachmentPath = null
      if (file) {
        attachmentPath = `${eventId}/${safeStorageFilename(file.name)}`
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
        rsvp_deadline: form.rsvpDeadlineEnabled && form.rsvp_deadline ? new Date(form.rsvp_deadline).toISOString() : null,
        rsvp_visibility: form.rsvpRestricted ? 'restricted' : 'all',
      }

      if (mode === 'edit') {
        const { error } = await supabase.from('club_events').update(payload).eq('id', eventId)
        if (error) throw error
        await supabase.from('event_invitees').delete().eq('event_id', eventId)
        // Clear any stale viewer rows too -- covers both "still restricted,
        // rebuild the list" and "was restricted, now reopened" cases.
        await supabase.from('event_rsvp_viewers').delete().eq('event_id', eventId)
      } else {
        const { error } = await supabase.from('club_events').insert({ id: eventId, ...payload })
        if (error) throw error
      }

      if (form.visibility === 'invite_only') {
        const inviteRows = [
          ...form.inviteeIds.map((profile_id) => ({ event_id: eventId, profile_id })),
          ...standingAttributeValueIds.map((attribute_value_id) => ({ event_id: eventId, attribute_value_id })),
          ...standingRoleIds.map((club_role_id) => ({ event_id: eventId, club_role_id })),
        ]
        if (inviteRows.length > 0) {
          const { error: inviteError } = await supabase.from('event_invitees').insert(inviteRows)
          if (inviteError) throw inviteError
        }
      }

      if (form.rsvpRestricted) {
        const viewerRows = [
          ...form.rsvpViewerIds.map((profile_id) => ({ event_id: eventId, profile_id })),
          ...rsvpStandingAttributeValueIds.map((attribute_value_id) => ({ event_id: eventId, attribute_value_id })),
          ...rsvpStandingRoleIds.map((club_role_id) => ({ event_id: eventId, club_role_id })),
        ]
        if (viewerRows.length > 0) {
          const { error: viewerError } = await supabase.from('event_rsvp_viewers').insert(viewerRows)
          if (viewerError) throw viewerError
        }
      }
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : '予定を追加しました')
      queryClient.invalidateQueries({ queryKey: ['club_events'] })
      queryClient.invalidateQueries({ queryKey: ['event_invitees'] })
      queryClient.invalidateQueries({ queryKey: ['event_rsvp_viewers'] })
      if (mode === 'create') {
        setForm(EMPTY_FORM)
        setCustomCategory('')
        setFile(null)
        setRemoveAttachment(false)
        setFilterAttrId('')
        setFilterValueId('')
        setFilterRoleId('')
        setRsvpFilterAttrId('')
        setRsvpFilterValueId('')
        setRsvpFilterRoleId('')
        setStandingAttributeValueIds([])
        setStandingRoleIds([])
        setRsvpStandingAttributeValueIds([])
        setRsvpStandingRoleIds([])
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
            <Label htmlFor="location">場所（任意）</Label>
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
            <Label htmlFor="description">詳細（任意）</Label>
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
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={form.rsvpDeadlineEnabled}
                onChange={(e) => setForm({ ...form, rsvpDeadlineEnabled: e.target.checked })}
              />
              参加投票の期限を設定する
            </label>
            {form.rsvpDeadlineEnabled && (
              <Input
                type="datetime-local"
                value={form.rsvp_deadline}
                onChange={(e) => setForm({ ...form, rsvp_deadline: e.target.value })}
              />
            )}
          </div>
          {form.visibility === 'invite_only' && (
            <div className="space-y-1.5">
              <Label>参加できるメンバー</Label>
              <div className="space-y-1.5 rounded-xl border border-input p-2">
                <Label className="text-xs text-muted-foreground">属性で一括選択</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={filterAttrId}
                    onValueChange={(v) => {
                      setFilterAttrId(v)
                      setFilterValueId('')
                    }}
                  >
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="属性を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributes?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filterValueId} onValueChange={setFilterValueId} disabled={!filterAttrId}>
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="値を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributeValues?.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="secondary" disabled={!filterValueId} onClick={applyAttributeFilter}>
                    選択を切替
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
                </p>
                <Button type="button" size="sm" variant="outline" disabled={!filterValueId} onClick={toggleStandingAttributeValue}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  この属性値を対象に追加（自動更新）
                </Button>
                <p className="text-xs text-muted-foreground">
                  属性そのものを対象にすると、後からその属性を持った人も自動的に対象に含まれます（個人選択は選んだ時点のメンバーで固定されます）。
                </p>
              </div>
              <div className="space-y-1.5 rounded-xl border border-input p-2">
                <Label className="text-xs text-muted-foreground">役職で一括選択</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select value={filterRoleId} onValueChange={setFilterRoleId}>
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="役職を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {clubRoles?.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.label_ja}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="secondary" disabled={!filterRoleId} onClick={applyRoleFilter}>
                    選択を切替
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
                </p>
                <Button type="button" size="sm" variant="outline" disabled={!filterRoleId} onClick={toggleStandingRole}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  この役職を対象に追加（自動更新）
                </Button>
                <p className="text-xs text-muted-foreground">
                  役職そのものを対象にすると、後からその役職に就いた人も自動的に対象に含まれます（個人選択は選んだ時点のメンバーで固定されます）。
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={selectAllInvitees}>
                  全員選択
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={deselectAllInvitees}>
                  全員解除
                </Button>
              </div>
              {(standingAttributeValueIds.length > 0 || standingRoleIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {standingAttributeValueIds.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1 border border-primary/40 bg-primary/10 text-primary">
                      <RefreshCw className="h-3 w-3" />
                      {standingAttributeValueLabels?.find((v) => v.id === id)?.value ?? '...'}（自動更新）
                      <button
                        type="button"
                        onClick={() => setStandingAttributeValueIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 hover:text-destructive"
                        aria-label="削除"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                  {standingRoleIds.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1 border border-primary/40 bg-primary/10 text-primary">
                      <RefreshCw className="h-3 w-3" />
                      {clubRoles?.find((r) => r.id === id)?.label_ja ?? '...'}（自動更新）
                      <button
                        type="button"
                        onClick={() => setStandingRoleIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 hover:text-destructive"
                        aria-label="削除"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
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
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={form.rsvpRestricted}
                onChange={(e) => setForm({ ...form, rsvpRestricted: e.target.checked })}
              />
              回答状況の閲覧を制限する
            </label>
            <p className="text-xs text-muted-foreground">
              チェックしない場合、この予定を見られる人は誰でも回答状況（参加/不参加/未回答の内訳）を見られます。制限すると、選んだメンバー（とアプリ管理者）だけが見られるようになります。
            </p>
          </div>
          {form.rsvpRestricted && (
            <div className="space-y-1.5">
              <Label>回答状況を見られるメンバー</Label>
              <div className="space-y-1.5 rounded-xl border border-input p-2">
                <Label className="text-xs text-muted-foreground">属性で一括選択</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={rsvpFilterAttrId}
                    onValueChange={(v) => {
                      setRsvpFilterAttrId(v)
                      setRsvpFilterValueId('')
                    }}
                  >
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="属性を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributes?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={rsvpFilterValueId} onValueChange={setRsvpFilterValueId} disabled={!rsvpFilterAttrId}>
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="値を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {rsvpAttributeValues?.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="secondary" disabled={!rsvpFilterValueId} onClick={applyRsvpAttributeFilter}>
                    選択を切替
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
                </p>
                <Button type="button" size="sm" variant="outline" disabled={!rsvpFilterValueId} onClick={toggleRsvpStandingAttributeValue}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  この属性値を対象に追加（自動更新）
                </Button>
                <p className="text-xs text-muted-foreground">
                  属性そのものを対象にすると、後からその属性を持った人も自動的に対象に含まれます（個人選択は選んだ時点のメンバーで固定されます）。
                </p>
              </div>
              <div className="space-y-1.5 rounded-xl border border-input p-2">
                <Label className="text-xs text-muted-foreground">役職で一括選択</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select value={rsvpFilterRoleId} onValueChange={setRsvpFilterRoleId}>
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="役職を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {clubRoles?.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.label_ja}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="secondary" disabled={!rsvpFilterRoleId} onClick={applyRsvpRoleFilter}>
                    選択を切替
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
                </p>
                <Button type="button" size="sm" variant="outline" disabled={!rsvpFilterRoleId} onClick={toggleRsvpStandingRole}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  この役職を対象に追加（自動更新）
                </Button>
                <p className="text-xs text-muted-foreground">
                  役職そのものを対象にすると、後からその役職に就いた人も自動的に対象に含まれます（個人選択は選んだ時点のメンバーで固定されます）。
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={selectAllRsvpViewers}>
                  全員選択
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={deselectAllRsvpViewers}>
                  全員解除
                </Button>
              </div>
              {(rsvpStandingAttributeValueIds.length > 0 || rsvpStandingRoleIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {rsvpStandingAttributeValueIds.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1 border border-primary/40 bg-primary/10 text-primary">
                      <RefreshCw className="h-3 w-3" />
                      {rsvpStandingAttributeValueLabels?.find((v) => v.id === id)?.value ?? '...'}（自動更新）
                      <button
                        type="button"
                        onClick={() => setRsvpStandingAttributeValueIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 hover:text-destructive"
                        aria-label="削除"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                  {rsvpStandingRoleIds.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1 border border-primary/40 bg-primary/10 text-primary">
                      <RefreshCw className="h-3 w-3" />
                      {clubRoles?.find((r) => r.id === id)?.label_ja ?? '...'}（自動更新）
                      <button
                        type="button"
                        onClick={() => setRsvpStandingRoleIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 hover:text-destructive"
                        aria-label="削除"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-input p-2">
                {members?.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                    <input
                      type="checkbox"
                      checked={form.rsvpViewerIds.includes(m.id)}
                      onChange={() => toggleRsvpViewer(m.id)}
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

  // Full member list + full invitee list, used to build the per-event
  // "who's going / not going / hasn't voted" breakdown below. The RSVP
  // breakdown is now open to everyone by default (not just officer+), so
  // this needs to work for any signed-in member -- profiles RLS normally
  // restricts a regular member to reading only their own row, so we go
  // through profiles_directory() (see 0013_profiles_directory.sql), a
  // SECURITY DEFINER RPC that already exists for exactly this purpose
  // (name/avatar/year roster, no sensitive columns) rather than querying
  // the profiles table directly.
  const { data: allProfiles } = useQuery({
    queryKey: ['profiles', 'rsvp-visibility'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('profiles_directory')
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  const { data: allInvitees } = useQuery({
    queryKey: ['event_invitees', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_invitees').select('event_id, profile_id')
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  // Which restricted events the current user is an approved RSVP-breakdown
  // viewer for. event_rsvp_viewers is readable by any signed-in member (see
  // 0042_rsvp_visibility.sql), so this is a simple self-filtered query.
  const { data: myRsvpViewerRows } = useQuery({
    queryKey: ['event_rsvp_viewers', 'mine', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('event_rsvp_viewers').select('event_id').eq('profile_id', user.id)
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  const myRsvpViewerEventIds = new Set((myRsvpViewerRows || []).map((r) => r.event_id))

  // Default (rsvp_visibility='all'): open to anyone who can see the event.
  // Restricted: only the hand-picked viewer list, plus executives as an
  // administrative override (same convention as is_executive() elsewhere,
  // e.g. Account Directory / Finance -- full access to sensitive views).
  function canViewRsvpBreakdown(event) {
    if (event.rsvp_visibility !== 'restricted') return true
    if (isExecutive) return true
    return myRsvpViewerEventIds.has(event.id)
  }

  // For a given event, split the eligible pool (all members for
  // visibility='all' events, invitees for invite_only) into three buckets
  // by their event_registrations status. "undecided" and "no row at all"
  // are both treated as 未回答 here -- neither is a firm answer.
  function rsvpBreakdown(event) {
    if (!allProfiles) return null
    const poolIds =
      event.visibility === 'all'
        ? allProfiles.map((p) => p.id)
        : (allInvitees || []).filter((i) => i.event_id === event.id).map((i) => i.profile_id)
    const nameById = new Map(allProfiles.map((p) => [p.id, p.full_name]))
    const statusByProfile = new Map(
      (registrations || []).filter((r) => r.event_id === event.id).map((r) => [r.profile_id, r.status])
    )
    const attending = []
    const notAttending = []
    const noResponse = []
    for (const id of poolIds) {
      const member = { id, name: nameById.get(id) || '不明なメンバー' }
      const status = statusByProfile.get(id)
      if (status === 'attending') attending.push(member)
      else if (status === 'not_attending') notAttending.push(member)
      else noResponse.push(member)
    }
    return { attending, notAttending, noResponse }
  }

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
      <p className="mb-5 text-sm text-muted-foreground">スケジュールを確認、参加登録できます</p>

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
                    <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
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
                      {e.rsvp_deadline && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          投票期限: {formatDateTime(e.rsvp_deadline)}
                        </span>
                      )}
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
              {canViewRsvpBreakdown(e) && (
                <details className="group mt-2 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-foreground">
                    <span className="flex items-center gap-2">
                      <UserRoundCheck className="h-3.5 w-3.5" />
                      回答状況を見る（権限が必要なことがあります）
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  {(() => {
                    const breakdown = rsvpBreakdown(e)
                    if (!breakdown) return <p className="mt-2">読み込み中...</p>
                    return (
                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <p className="mb-1 font-medium text-foreground">参加（{breakdown.attending.length}）</p>
                          {breakdown.attending.length === 0 && <p className="text-muted-foreground/70">なし</p>}
                          {breakdown.attending.map((m) => (
                            <p key={m.id}>{m.name}</p>
                          ))}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-foreground">不参加（{breakdown.notAttending.length}）</p>
                          {breakdown.notAttending.length === 0 && <p className="text-muted-foreground/70">なし</p>}
                          {breakdown.notAttending.map((m) => (
                            <p key={m.id}>{m.name}</p>
                          ))}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-foreground">未回答（{breakdown.noResponse.length}）</p>
                          {breakdown.noResponse.length === 0 && <p className="text-muted-foreground/70">なし</p>}
                          {breakdown.noResponse.map((m) => (
                            <p key={m.id}>{m.name}</p>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </details>
              )}
            </motion.div>
          )
        })}
      </div>

      {editing && <EventFormDialog mode="edit" event={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}

      <details className="group mt-8 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-foreground">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            スマホのカレンダーと同期する
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-1">
          <p>この予定表はスマホの標準カレンダーアプリに登録できます。</p>
          <p>
            <RouterLink to="/settings" className="font-medium text-primary hover:underline">
              設定ページ
            </RouterLink>
            で自分専用のリンクを確認してください。
          </p>
          <p>iPhoneの場合: リンクをタップして「登録」を選ぶだけ。</p>
          <p>Android・Googleカレンダーの場合: 「他のカレンダー」→「URLで追加」でリンクを貼り付けてください。</p>
        </div>
      </details>
    </div>
  )
}
