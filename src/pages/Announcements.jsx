import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Megaphone, Pencil, Pin, Plus, RefreshCw, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const CATEGORY_LABEL = {
  notice: 'お知らせ',
  event: 'イベント',
  important: '重要',
  practice: '練習',
  other: 'その他',
}

const CATEGORY_VARIANT = {
  important: 'default',
}

const EMPTY_FORM = { title: '', body: '', category: 'notice', pinned: false, visibility: 'all', recipientIds: [] }

function AnnouncementFormDialog({ mode, announcement, trigger, open, onOpenChange }) {
  const isPreset = (cat) => Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, cat)
  const [form, setForm] = useState(
    mode === 'edit'
      ? {
          ...announcement,
          category: isPreset(announcement.category) ? announcement.category : 'other',
          visibility: announcement.visibility || 'all',
          recipientIds: [],
        }
      : EMPTY_FORM
  )
  const [customCategory, setCustomCategory] = useState(mode === 'edit' && !isPreset(announcement.category) ? announcement.category || '' : '')
  const [filterAttrId, setFilterAttrId] = useState('')
  const [filterValueId, setFilterValueId] = useState('')
  const [filterRoleId, setFilterRoleId] = useState('')
  // "Standing" targets: instead of resolving the filter to today's matching
  // profiles, remember the attribute value / role itself so membership stays
  // live (see 0064_dynamic_group_targets.sql). Parallel to recipientIds, not
  // a replacement -- both kinds of rows go into announcement_recipients.
  const [standingAttributeValueIds, setStandingAttributeValueIds] = useState([])
  const [standingRoleIds, setStandingRoleIds] = useState([])
  const queryClient = useQueryClient()

  const { data: members } = useQuery({
    queryKey: ['profiles', 'for-announcement-target'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return data
    },
    enabled: open && form.visibility === 'targeted',
  })

  const { data: existingRecipients } = useQuery({
    queryKey: ['announcement_recipients', announcement?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcement_recipients')
        .select('profile_id, attribute_value_id, club_role_id')
        .eq('announcement_id', announcement.id)
      if (error) throw error
      return data
    },
    enabled: mode === 'edit' && open && announcement.visibility === 'targeted',
  })

  useEffect(() => {
    if (!existingRecipients) return
    setForm((f) => ({ ...f, recipientIds: existingRecipients.filter((r) => r.profile_id).map((r) => r.profile_id) }))
    setStandingAttributeValueIds(existingRecipients.filter((r) => r.attribute_value_id).map((r) => r.attribute_value_id))
    setStandingRoleIds(existingRecipients.filter((r) => r.club_role_id).map((r) => r.club_role_id))
  }, [existingRecipients])

  // Attribute-based bulk selection: pick an attribute + value, then flip
  // (toggle) everyone tagged with that value in the recipient checklist at
  // once -- same pattern as Schedule.jsx's invitee picker and Tasks.jsx's
  // assignee picker. Anyone already selected in the matched group gets
  // deselected, anyone not yet selected gets selected.
  const { data: attributes } = useQuery({
    queryKey: ['member_attributes', 'for-announcement-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attributes').select('id, label').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: open && form.visibility === 'targeted',
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

  // Label lookup for standing-target chips: standingAttributeValueIds can
  // span attributes other than the one currently selected in the filter
  // above, so it needs its own by-id fetch rather than reusing attributeValues.
  const { data: standingAttributeValueLabels } = useQuery({
    queryKey: ['member_attribute_values', 'standing-labels', standingAttributeValueIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').in('id', standingAttributeValueIds)
      if (error) throw error
      return data
    },
    enabled: standingAttributeValueIds.length > 0,
  })

  // Role-based bulk selection (same XOR-toggle pattern as the attribute
  // filter above, but resolved via profile_roles instead of
  // profile_attribute_values).
  const { data: clubRoles } = useQuery({
    queryKey: ['club_roles', 'for-announcement-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('id, label_ja').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: open && form.visibility === 'targeted',
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
    const next = new Set(form.recipientIds)
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
    setForm((f) => ({ ...f, recipientIds: Array.from(next) }))
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
    const next = new Set(form.recipientIds)
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
    setForm((f) => ({ ...f, recipientIds: Array.from(next) }))
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

  function toggleRecipient(id) {
    setForm((f) => ({
      ...f,
      recipientIds: f.recipientIds.includes(id) ? f.recipientIds.filter((x) => x !== id) : [...f.recipientIds, id],
    }))
  }

  function selectAllRecipients() {
    setForm((f) => ({ ...f, recipientIds: (members || []).map((m) => m.id) }))
  }

  function deselectAllRecipients() {
    setForm((f) => ({ ...f, recipientIds: [] }))
  }

  const save = useMutation({
    mutationFn: async () => {
      const finalCategory = form.category === 'other' && customCategory.trim() ? customCategory.trim() : form.category
      const payload = { title: form.title, body: form.body, category: finalCategory, pinned: form.pinned, visibility: form.visibility }
      const announcementId = mode === 'edit' ? announcement.id : crypto.randomUUID()

      if (mode === 'edit') {
        const { error } = await supabase.from('announcements').update(payload).eq('id', announcementId)
        if (error) throw error
        await supabase.from('announcement_recipients').delete().eq('announcement_id', announcementId)
      } else {
        const { error } = await supabase.from('announcements').insert({ id: announcementId, ...payload })
        if (error) throw error
      }

      if (form.visibility === 'targeted') {
        const recipientRows = [
          ...form.recipientIds.map((profile_id) => ({ announcement_id: announcementId, profile_id })),
          ...standingAttributeValueIds.map((attribute_value_id) => ({ announcement_id: announcementId, attribute_value_id })),
          ...standingRoleIds.map((club_role_id) => ({ announcement_id: announcementId, club_role_id })),
        ]
        if (recipientRows.length > 0) {
          const { error: recipientError } = await supabase.from('announcement_recipients').insert(recipientRows)
          if (recipientError) throw recipientError
        }
      }
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : 'お知らせを投稿しました')
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      queryClient.invalidateQueries({ queryKey: ['announcement_recipients'] })
      if (mode === 'create') {
        setForm(EMPTY_FORM)
        setCustomCategory('')
        setFilterAttrId('')
        setFilterValueId('')
        setFilterRoleId('')
        setStandingAttributeValueIds([])
        setStandingRoleIds([])
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
          <DialogTitle>{mode === 'edit' ? 'お知らせを編集' : 'お知らせを投稿'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="a-title">タイトル</Label>
            <Input id="a-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-body">本文</Label>
            <Textarea id="a-body" required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
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
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="h-4 w-4 rounded" />
            上部に固定表示する
          </label>
          <div className="space-y-1.5">
            <Label>配信範囲</Label>
            <Select value={form.visibility} onValueChange={(v) => setForm({ ...form, visibility: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全員に配信</SelectItem>
                <SelectItem value="targeted">特定のメンバーのみ</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.visibility === 'targeted' && (
            <div className="space-y-1.5">
              <Label>配信するメンバー</Label>
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
                <Button type="button" size="sm" variant="outline" onClick={selectAllRecipients}>
                  全員選択
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={deselectAllRecipients}>
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
                      checked={form.recipientIds.includes(m.id)}
                      onChange={() => toggleRecipient(m.id)}
                      className="h-4 w-4 rounded"
                    />
                    {m.full_name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {mode === 'edit' ? '保存する' : '投稿する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Announcements() {
  const { profile } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: announcements, isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const { data, error } = await supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Recipient counts for targeted announcements -- RLS on announcement_recipients
  // is executive-only (same gate as writing announcements), so this only runs
  // for executives; officers won't see the breakdown even though they can see
  // the "特定のメンバーのみ" badge itself.
  const { data: recipientCounts } = useQuery({
    queryKey: ['announcement_recipients', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('announcement_recipients').select('announcement_id')
      if (error) throw error
      const counts = {}
      for (const r of data) counts[r.announcement_id] = (counts[r.announcement_id] || 0) + 1
      return counts
    },
    enabled: isExecutive,
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('announcements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcements'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">お知らせ</h1>
        {isExecutive && (
          <AnnouncementFormDialog
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
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!isLoading && (!announcements || announcements.length === 0) && (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <Megaphone className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">お知らせはまだありません</p>
        </Card>
      )}

      <div className="space-y-3">
        {announcements?.map((a, i) => (
          <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(i, 5) * 0.03 }}>
            <Card className="p-5">
              <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {a.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  <h3 className="font-bold">{a.title}</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  {a.visibility === 'targeted' && (
                    <Badge variant="outline" className="gap-1">
                      <Users className="h-3 w-3" />
                      特定{isExecutive && recipientCounts?.[a.id] != null ? `${recipientCounts[a.id]}人` : ''}
                    </Badge>
                  )}
                  <Badge variant={CATEGORY_VARIANT[a.category] || 'secondary'}>{CATEGORY_LABEL[a.category] || a.category}</Badge>
                  {isExecutive && (
                    <>
                      <button onClick={() => setEditing(a)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('このお知らせを削除しますか？')) remove.mutate(a.id)
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
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      {editing && (
        <AnnouncementFormDialog mode="edit" announcement={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />
      )}
    </div>
  )
}
