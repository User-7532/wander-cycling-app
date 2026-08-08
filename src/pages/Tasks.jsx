import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useOutletContext } from 'react-router-dom'
import { CalendarClock, ChevronDown, ListTodo, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const STATUS_LABEL = { todo: '未着手', in_progress: '進行中', done: '完了' }
const STATUS_ORDER = ['todo', 'in_progress', 'done']
const PRIORITY_LABEL = { low: '低', medium: '中', high: '高' }
const PRIORITY_CLASS = {
  high: 'border-destructive/40 text-destructive',
  medium: 'border-primary/40 text-primary',
  low: 'border-muted-foreground/30 text-muted-foreground',
}
const EMPTY_FORM = { title: '', description: '', assigned_to: '', priority: 'medium', due_at: '', visibility: 'restricted' }
const VISIBILITY_LABEL = {
  all: '全員に公開',
  restricted: 'アプリ管理者・三役・担当者のみ',
  private: 'アプリ管理者・担当者のみ',
}

// tasks.due_at is a timestamptz (UTC ISO string). <input type="datetime-local">
// needs/returns a timezone-less "YYYY-MM-DDTHH:mm" string in local time.
function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDueAt(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isOverdue(task) {
  return task.status !== 'done' && !!task.due_at && new Date(task.due_at).getTime() < Date.now()
}

function TaskFormDialog({ mode, task, members, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(
    mode === 'edit'
      ? {
          title: task.title,
          description: task.description || '',
          assigned_to: task.assigned_to || '',
          priority: task.priority,
          due_at: toLocalInputValue(task.due_at),
          visibility: task.visibility,
        }
      : EMPTY_FORM
  )
  const [bulkMode, setBulkMode] = useState(false)
  // 複数人に同時にアサインするとき、各自が別々に完了させる通常タスクか、
  // 誰か1人が完了したら全員分が完了になる協働タスクか（例:「花火購入」— 誰かが
  // 買えば全員にとって終わり）。task_group_idを共有する行として作成し、実際の
  // 連鎖完了はDBトリガー(propagate_shared_task_completion, 0059)側で行う。
  const [sharedTask, setSharedTask] = useState(false)
  const [filterAttrId, setFilterAttrId] = useState('')
  const [filterValueId, setFilterValueId] = useState('')
  const [filterRoleId, setFilterRoleId] = useState('')
  // "Standing" assignment target: instead of (or alongside) flip-selecting a
  // snapshot of matching people into selectedIds, remember the attribute
  // value / role itself (see 0066_task_templates.sql). A DB trigger then
  // auto-creates a task for anyone who gains this attribute/role later.
  // Limited to a single target (not an AND-chain) so "has this profile
  // already got a task from this template" stays a simple check.
  const [standingAssignTarget, setStandingAssignTarget] = useState(null)
  // その他、閲覧できる人（task_visible_to）を選ぶための、上の属性/役職フィルタ
  // と同じ仕組みの別インスタンス（Schedule.jsx/Announcements.jsxの招待者
  // ピッカーと同一パターン）。selectedIds（一括作成の対象者）とは独立。
  const [visFilterAttrId, setVisFilterAttrId] = useState('')
  const [visFilterValueId, setVisFilterValueId] = useState('')
  const [visFilterRoleId, setVisFilterRoleId] = useState('')
  const [visibleToIds, setVisibleToIds] = useState([])
  // "Standing" targets: instead of resolving the filter to today's matching
  // profiles, remember the attribute value / role itself so membership stays
  // live (see 0064_dynamic_group_targets.sql). Parallel to visibleToIds, not
  // a replacement -- both kinds of rows go into task_visible_to.
  const [standingAttributeValueIds, setStandingAttributeValueIds] = useState([])
  const [standingRoleIds, setStandingRoleIds] = useState([])
  // Collapsed by default -- rarely needed, and the filter/role/checklist UI
  // inside makes the dialog very tall if always expanded.
  const [visSectionOpen, setVisSectionOpen] = useState(false)
  // selectedIds is the actual bulk-create target group. It is NOT derived
  // live from the filter condition below -- the filter condition is a
  // preview of who an "適用" click would affect. Clicking apply flips
  // (XORs) the currently-matched people's membership in selectedIds, so
  // e.g. "全員選択" then applying a "3年" filter deselects exactly the
  // 3年 people, leaving everyone else selected.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const queryClient = useQueryClient()

  // Existing task_visible_to rows, for prefilling visibleToIds in edit mode
  // (same shape as Schedule.jsx's existingInvitees / event_invitees).
  const { data: existingVisibleTo } = useQuery({
    queryKey: ['task_visible_to', task?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('task_visible_to').select('profile_id, attribute_value_id, club_role_id').eq('task_id', task.id)
      if (error) throw error
      return data
    },
    enabled: mode === 'edit' && open && task.visibility !== 'all',
  })

  useEffect(() => {
    if (!existingVisibleTo) return
    setVisibleToIds(existingVisibleTo.filter((r) => r.profile_id).map((r) => r.profile_id))
    setStandingAttributeValueIds(existingVisibleTo.filter((r) => r.attribute_value_id).map((r) => r.attribute_value_id))
    setStandingRoleIds(existingVisibleTo.filter((r) => r.club_role_id).map((r) => r.club_role_id))
  }, [existingVisibleTo])

  const save = useMutation({
    mutationFn: async () => {
      const taskId = mode === 'edit' ? task.id : crypto.randomUUID()
      const payload = {
        title: form.title,
        description: form.description || null,
        assigned_to: form.assigned_to || null,
        priority: form.priority,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        visibility: form.visibility,
      }
      if (mode === 'edit') {
        const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
        if (error) throw error
        await supabase.from('task_visible_to').delete().eq('task_id', taskId)
      } else {
        const { error } = await supabase.from('tasks').insert({ id: taskId, ...payload })
        if (error) throw error
      }

      if (form.visibility !== 'all') {
        const visRows = [
          ...visibleToIds.map((profile_id) => ({ task_id: taskId, profile_id })),
          ...standingAttributeValueIds.map((attribute_value_id) => ({ task_id: taskId, attribute_value_id })),
          ...standingRoleIds.map((club_role_id) => ({ task_id: taskId, club_role_id })),
        ]
        if (visRows.length > 0) {
          const { error: visError } = await supabase.from('task_visible_to').insert(visRows)
          if (visError) throw visError
        }
      }
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : 'タスクを追加しました')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task_visible_to'] })
      if (mode === 'create') {
        setForm(EMPTY_FORM)
        setVisFilterAttrId('')
        setVisFilterValueId('')
        setVisFilterRoleId('')
        setVisibleToIds([])
        setStandingAttributeValueIds([])
        setStandingRoleIds([])
      }
      onOpenChange(false)
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  // Bulk-create mode: pick an attribute+value filter (member_attributes / member_attribute_values),
  // resolve to matching profiles via profile_attribute_values, then insert one tasks row per profile.
  const { data: attributes } = useQuery({
    queryKey: ['member_attributes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attributes').select('id, key, label').order('sort_order')
      if (error) throw error
      return data
    },
    // Also needed for the "その他、閲覧できる人を追加" picker under visibility='restricted'.
    enabled: (mode === 'create' && bulkMode) || (open && form.visibility !== 'all'),
  })

  const { data: attributeValues } = useQuery({
    queryKey: ['member_attribute_values', filterAttrId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').eq('attribute_id', filterAttrId).order('sort_order')
      if (error) throw error
      return data
    },
    enabled: !!filterAttrId,
  })

  // Label lookup for the standing-target chip: standingAssignTarget can
  // reference an attribute value from a DIFFERENT attribute than the one
  // currently selected in the dropdown above, so it needs its own by-id
  // fetch rather than reusing attributeValues (same reasoning as
  // Schedule.jsx's standingAttributeValueLabels).
  const { data: standingAssignValueLabel } = useQuery({
    queryKey: ['member_attribute_values', 'standing-assign-label', standingAssignTarget?.valueId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('value').eq('id', standingAssignTarget.valueId).maybeSingle()
      if (error) throw error
      return data?.value ?? null
    },
    enabled: standingAssignTarget?.kind === 'attribute' && !!standingAssignTarget.valueId,
  })

  // Role-based bulk selection (pick a club role, then XOR-toggle its
  // members into selectedIds), shared between this picker and the
  // "その他、閲覧できる人を追加" picker below, same as attributes above.
  const { data: clubRoles } = useQuery({
    queryKey: ['club_roles', 'for-task-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('id, label_ja').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: (mode === 'create' && bulkMode) || (open && form.visibility !== 'all'),
  })

  const selectedProfiles = (members ?? []).filter((m) => selectedIds.has(m.id))

  function toggleProfile(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  async function applyFilterToggle() {
    if (!filterValueId) return
    const { data, error } = await supabase.from('profile_attribute_values').select('profile_id').eq('attribute_value_id', filterValueId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(selectedIds)
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
    setSelectedIds(next)
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
    if (ids.length === 0) return
    const next = new Set(selectedIds)
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
    setSelectedIds(next)
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }
  function selectAllProfiles() {
    setSelectedIds(new Set((members ?? []).map((m) => m.id)))
  }
  function deselectAllProfiles() {
    setSelectedIds(new Set())
  }
  function toggleStandingAssignAttribute() {
    if (!filterValueId) return
    setStandingAssignTarget((prev) => (prev?.kind === 'attribute' && prev.valueId === filterValueId ? null : { kind: 'attribute', valueId: filterValueId }))
  }
  function toggleStandingAssignRole() {
    if (!filterRoleId) return
    setStandingAssignTarget((prev) => (prev?.kind === 'role' && prev.roleId === filterRoleId ? null : { kind: 'role', roleId: filterRoleId }))
  }

  // Same picker pattern as the bulk-assign one above, but for the
  // "その他、閲覧できる人を追加" (task_visible_to) picker shown when
  // visibility != 'all'. Independent state, same shape as Schedule.jsx's
  // RSVP-viewer picker relative to its invitee picker.
  const { data: visAttributeValues } = useQuery({
    queryKey: ['member_attribute_values', visFilterAttrId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').eq('attribute_id', visFilterAttrId).order('sort_order')
      if (error) throw error
      return data
    },
    enabled: !!visFilterAttrId,
  })

  // Label lookups for the standing-target chips: standingAttributeValueIds
  // can span attributes other than the one currently selected in the
  // dropdown above, so they need their own by-id fetch.
  const { data: standingAttributeValueLabels } = useQuery({
    queryKey: ['member_attribute_values', 'standing-labels', standingAttributeValueIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').in('id', standingAttributeValueIds)
      if (error) throw error
      return data
    },
    enabled: standingAttributeValueIds.length > 0,
  })

  function toggleVisibleTo(id) {
    setVisibleToIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  // Adds/removes the currently-selected attribute value or role itself as a
  // standing target, reusing the same visFilterValueId/visFilterRoleId
  // selection as the flip-toggle buttons -- no profile resolution, just
  // remembering the id.
  function toggleStandingAttributeValue() {
    if (!visFilterValueId) return
    setStandingAttributeValueIds((prev) => (prev.includes(visFilterValueId) ? prev.filter((x) => x !== visFilterValueId) : [...prev, visFilterValueId]))
  }
  function toggleStandingRole() {
    if (!visFilterRoleId) return
    const roleId = Number(visFilterRoleId)
    setStandingRoleIds((prev) => (prev.includes(roleId) ? prev.filter((x) => x !== roleId) : [...prev, roleId]))
  }
  async function applyVisFilterToggle() {
    if (!visFilterValueId) return
    const { data, error } = await supabase.from('profile_attribute_values').select('profile_id').eq('attribute_value_id', visFilterValueId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(visibleToIds)
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
    setVisibleToIds([...next])
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }
  async function applyVisRoleFilter() {
    if (!visFilterRoleId) return
    const { data, error } = await supabase.from('profile_roles').select('profile_id').eq('club_role_id', visFilterRoleId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    if (ids.length === 0) return
    const next = new Set(visibleToIds)
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
    setVisibleToIds([...next])
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }
  function selectAllVisibleTo() {
    setVisibleToIds((members ?? []).map((m) => m.id))
  }
  function deselectAllVisibleTo() {
    setVisibleToIds([])
  }

  const bulkSave = useMutation({
    mutationFn: async () => {
      const taskGroupId = sharedTask ? crypto.randomUUID() : null

      // People currently matched by the standing target get their task via
      // create_task_template's own materialization below -- exclude them
      // from the manual snapshot insert so they don't end up with 2 tasks.
      let standingMatchedIds = new Set()
      if (standingAssignTarget?.kind === 'attribute') {
        const { data, error } = await supabase.from('profile_attribute_values').select('profile_id').eq('attribute_value_id', standingAssignTarget.valueId)
        if (error) throw error
        standingMatchedIds = new Set(data.map((r) => r.profile_id))
      } else if (standingAssignTarget?.kind === 'role') {
        const { data, error } = await supabase.from('profile_roles').select('profile_id').eq('club_role_id', standingAssignTarget.roleId)
        if (error) throw error
        standingMatchedIds = new Set(data.map((r) => r.profile_id))
      }
      const manualProfiles = selectedProfiles.filter((p) => !standingMatchedIds.has(p.id))

      const rows = manualProfiles.map((p) => ({
        id: crypto.randomUUID(),
        title: form.title,
        description: form.description || null,
        assigned_to: p.id,
        priority: form.priority,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        visibility: form.visibility,
        task_group_id: taskGroupId,
      }))
      if (rows.length > 0) {
        const { error } = await supabase.from('tasks').insert(rows)
        if (error) throw error

        if (form.visibility !== 'all') {
          const visRows = rows.flatMap((r) => [
            ...visibleToIds.map((profile_id) => ({ task_id: r.id, profile_id })),
            ...standingAttributeValueIds.map((attribute_value_id) => ({ task_id: r.id, attribute_value_id })),
            ...standingRoleIds.map((club_role_id) => ({ task_id: r.id, club_role_id })),
          ])
          if (visRows.length > 0) {
            const { error: visError } = await supabase.from('task_visible_to').insert(visRows)
            if (visError) throw visError
          }
        }
      }

      if (standingAssignTarget) {
        const visibleToPayload =
          form.visibility === 'all'
            ? []
            : [
                ...visibleToIds.map((profile_id) => ({ profile_id })),
                ...standingAttributeValueIds.map((attribute_value_id) => ({ attribute_value_id })),
                ...standingRoleIds.map((club_role_id) => ({ club_role_id })),
              ]
        const { error } = await supabase.rpc('create_task_template', {
          p_title: form.title,
          p_description: form.description || null,
          p_priority: form.priority,
          p_due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
          p_visibility: form.visibility,
          p_task_group_id: taskGroupId,
          p_attribute_value_id: standingAssignTarget.kind === 'attribute' ? standingAssignTarget.valueId : null,
          p_club_role_id: standingAssignTarget.kind === 'role' ? Number(standingAssignTarget.roleId) : null,
          p_visible_to: visibleToPayload,
        })
        if (error) throw error
      }

      return rows.length + standingMatchedIds.size
    },
    onSuccess: (count) => {
      toast.success(`${count}件のタスクを追加しました`)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setForm(EMPTY_FORM)
      setBulkMode(false)
      setSharedTask(false)
      setFilterAttrId('')
      setFilterValueId('')
      setFilterRoleId('')
      setSelectedIds(new Set())
      setStandingAssignTarget(null)
      setVisFilterAttrId('')
      setVisFilterValueId('')
      setVisFilterRoleId('')
      setVisibleToIds([])
      setStandingAttributeValueIds([])
      setStandingRoleIds([])
      onOpenChange(false)
    },
    onError: (err) => toast.error(`追加に失敗しました: ${err.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'タスクを編集' : 'タスクを追加'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (mode === 'create' && bulkMode) {
              bulkSave.mutate()
            } else {
              save.mutate()
            }
          }}
          className="space-y-3"
        >
          {mode === 'create' && (
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={!bulkMode ? 'default' : 'outline'} onClick={() => setBulkMode(false)}>
                個人に割り当て
              </Button>
              <Button type="button" size="sm" variant={bulkMode ? 'default' : 'outline'} onClick={() => setBulkMode(true)}>
                グループへ一括作成
              </Button>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="t-title">タイトル</Label>
            <Input id="t-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">詳細（任意）</Label>
            <Textarea id="t-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {!(mode === 'create' && bulkMode) ? (
            <div className="space-y-1.5">
              <Label>担当者（任意）</Label>
              <Select value={form.assigned_to} onValueChange={(v) => setForm({ ...form, assigned_to: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  {members?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border p-3">
              <Label>対象条件</Label>
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
                  <Button type="button" size="sm" variant="secondary" disabled={!filterValueId} onClick={applyFilterToggle}>
                    選択を切替
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant={standingAssignTarget?.kind === 'attribute' && standingAssignTarget.valueId === filterValueId ? 'default' : 'outline'}
                  disabled={!filterValueId}
                  onClick={toggleStandingAssignAttribute}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  この属性値を持つ人に自動でタスクを作成
                </Button>
                <p className="text-xs text-muted-foreground">
                  後からこの属性を持った人にも自動でタスクが作成されます（上のチェックリストは選んだ時点のメンバーで固定されます）。
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
                <Button
                  type="button"
                  size="sm"
                  variant={standingAssignTarget?.kind === 'role' && standingAssignTarget.roleId === filterRoleId ? 'default' : 'outline'}
                  disabled={!filterRoleId}
                  onClick={toggleStandingAssignRole}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  この役職の人に自動でタスクを作成
                </Button>
                <p className="text-xs text-muted-foreground">
                  後からこの役職に就いた人にも自動でタスクが作成されます（上のチェックリストは選んだ時点のメンバーで固定されます）。
                </p>
              </div>

              {standingAssignTarget && (
                <Badge variant="secondary" className="gap-1 border border-primary/40 bg-primary/10 text-primary">
                  <RefreshCw className="h-3 w-3" />
                  {standingAssignTarget.kind === 'attribute'
                    ? (standingAssignValueLabel ?? '...')
                    : (clubRoles?.find((r) => String(r.id) === String(standingAssignTarget.roleId))?.label_ja ?? '...')}
                  を自動対象に設定中（新規参入者にも自動でタスクが作られます）
                  <button type="button" onClick={() => setStandingAssignTarget(null)} className="ml-0.5 hover:text-destructive" aria-label="削除">
                    ×
                  </button>
                </Badge>
              )}

              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={selectAllProfiles}>
                  全員選択
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={deselectAllProfiles}>
                  全員解除
                </Button>
              </div>
              <div className="space-y-1.5 pt-1">
                <Label>対象者（{selectedProfiles.length}人選択中）</Label>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {members?.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleProfile(m.id)} />
                      {m.full_name}
                    </label>
                  ))}
                </div>
              </div>
              {(selectedProfiles.length > 1 || !!standingAssignTarget) && (
                <div className="space-y-1.5 border-t pt-3">
                  <Label>進行方式</Label>
                  <Select value={sharedTask ? 'shared' : 'individual'} onValueChange={(v) => setSharedTask(v === 'shared')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="individual">別々に進行（全員が自分の分を完了させる）</SelectItem>
                      <SelectItem value="shared">協働タスク（誰か1人が完了したら全員分が完了になる）</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    例:「花火購入」のように、誰か1人がやれば全員にとって終わりのタスクは協働タスクを選んでください。
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>公開範囲</Label>
            <Select value={form.visibility} onValueChange={(v) => setForm({ ...form, visibility: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{VISIBILITY_LABEL.all}</SelectItem>
                <SelectItem value="restricted">{VISIBILITY_LABEL.restricted}</SelectItem>
                <SelectItem value="private">{VISIBILITY_LABEL.private}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              「{VISIBILITY_LABEL.private}」は三役には自動的に共有されません。些細な個人タスクなど、通知を広げたくない場合に選んでください。
            </p>
          </div>
          {form.visibility !== 'all' && (
            <div className="space-y-3 rounded-lg border p-3">
              <button
                type="button"
                onClick={() => setVisSectionOpen((v) => !v)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${visSectionOpen ? 'rotate-180' : ''}`} />
                その他、閲覧できる人を追加（任意）
              </button>
              <p className="text-xs text-muted-foreground">
                担当者以外の人が気づかず同じ作業を始めてしまわないよう、事前に知らせておきたい人がいる場合に追加してください。
              </p>
              {visSectionOpen && (
                <>
                  <div className="space-y-1.5 rounded-xl border border-input p-2">
                    <Label className="text-xs text-muted-foreground">属性で一括選択</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select
                        value={visFilterAttrId}
                        onValueChange={(v) => {
                          setVisFilterAttrId(v)
                          setVisFilterValueId('')
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
                      <Select value={visFilterValueId} onValueChange={setVisFilterValueId} disabled={!visFilterAttrId}>
                        <SelectTrigger className="sm:flex-1">
                          <SelectValue placeholder="値を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {visAttributeValues?.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" size="sm" variant="secondary" disabled={!visFilterValueId} onClick={applyVisFilterToggle}>
                        選択を切替
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant={standingAttributeValueIds.includes(visFilterValueId) ? 'default' : 'outline'}
                      disabled={!visFilterValueId}
                      onClick={toggleStandingAttributeValue}
                    >
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
                      <Select value={visFilterRoleId} onValueChange={setVisFilterRoleId}>
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
                      <Button type="button" size="sm" variant="secondary" disabled={!visFilterRoleId} onClick={applyVisRoleFilter}>
                        選択を切替
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant={standingRoleIds.includes(Number(visFilterRoleId)) ? 'default' : 'outline'}
                      disabled={!visFilterRoleId}
                      onClick={toggleStandingRole}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      この役職を対象に追加（自動更新）
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      役職そのものを対象にすると、後からその役職に就いた人も自動的に対象に含まれます（個人選択は選んだ時点のメンバーで固定されます）。
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={selectAllVisibleTo}>
                      全員選択
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={deselectAllVisibleTo}>
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
                  <div className="space-y-1.5 pt-1">
                    <Label>対象者（{visibleToIds.length}人選択中）</Label>
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                      {members?.map((m) => (
                        <label key={m.id} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={visibleToIds.includes(m.id)} onChange={() => toggleVisibleTo(m.id)} />
                          {m.full_name}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>優先度</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-due">期限（任意）</Label>
              <Input id="t-due" type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
            </div>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={save.isPending || bulkSave.isPending || (mode === 'create' && bulkMode && selectedProfiles.length === 0 && !standingAssignTarget)}
          >
            {mode === 'edit'
              ? '保存する'
              : mode === 'create' && bulkMode
                ? standingAssignTarget
                  ? `${selectedProfiles.length}人 + 自動対象にタスクを作成`
                  : `${selectedProfiles.length}人にタスクを作成`
                : '追加する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Tasks() {
  const { user, profile, isYakuin } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const isOfficerPlus = ['executive', 'officer'].includes(profile?.club_roles?.tier)
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  // View-mode filter over the RLS-scoped task list, relevant mainly to
  // 三役/アプリ管理者 who (per 0055_task_visibility.sql) can now see a
  // broader set of tasks than just their own. Purely client-side.
  const [viewFilter, setViewFilter] = useState('mine')
  const [viewFilterProfileId, setViewFilterProfileId] = useState('')
  const [viewFilterAttrId, setViewFilterAttrId] = useState('')
  const [viewFilterValueId, setViewFilterValueId] = useState('')
  const [viewFilterRoleId, setViewFilterRoleId] = useState('')
  const canFilterView = isExecutive || isYakuin
  // Single shared confirm-before-status-change dialog (not one per task
  // card). Status changes now fire a club-wide LINE notification to
  // everyone who can see the task (DB trigger + Edge Function), so a
  // careless click on 未着手/進行中/完了 should not go straight through.
  const [confirmingStatus, setConfirmingStatus] = useState(null)

  const { data: tasks, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      // RLS already scopes rows: officer+ see everything, others see only their own assignments.
      const { data, error } = await supabase
        .from('tasks')
        .select('*, assignee:profiles!tasks_assigned_to_fkey(full_name)')
        .order('due_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data
    },
  })

  const { data: members } = useQuery({
    queryKey: ['profiles', 'for-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return data
    },
    // isExecutive needs this for TaskFormDialog's assignee/visibility pickers;
    // isYakuin needs it for the "特定の人" view filter below.
    enabled: isExecutive || isYakuin,
  })

  const { data: viewFilterAttributes } = useQuery({
    queryKey: ['member_attributes', 'for-task-view-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attributes').select('id, label').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: canFilterView && viewFilter === 'condition',
  })

  const { data: viewFilterAttributeValues } = useQuery({
    queryKey: ['member_attribute_values', 'for-task-view-filter', viewFilterAttrId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_attribute_values')
        .select('id, value')
        .eq('attribute_id', viewFilterAttrId)
        .order('sort_order')
      if (error) throw error
      return data
    },
    enabled: !!viewFilterAttrId,
  })

  const { data: viewFilterClubRoles } = useQuery({
    queryKey: ['club_roles', 'for-task-view-filter'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('id, label_ja').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: canFilterView && viewFilter === 'condition',
  })

  // Profile ids matching the "条件を満たす人" condition. Role takes
  // priority if both happen to be set (selecting one clears the other below).
  const { data: viewFilterProfileIds } = useQuery({
    queryKey: ['task-view-filter-profiles', viewFilterRoleId, viewFilterValueId],
    queryFn: async () => {
      if (viewFilterRoleId) {
        const { data, error } = await supabase.from('profile_roles').select('profile_id').eq('club_role_id', viewFilterRoleId)
        if (error) throw error
        return data.map((r) => r.profile_id)
      }
      const { data, error } = await supabase.from('profile_attribute_values').select('profile_id').eq('attribute_value_id', viewFilterValueId)
      if (error) throw error
      return data.map((r) => r.profile_id)
    },
    enabled: canFilterView && viewFilter === 'condition' && (!!viewFilterRoleId || !!viewFilterValueId),
  })

  // A 協働タスク's group membership must always be computed from the FULL
  // task list, never from a filter-narrowed subset -- otherwise the same
  // real-world task renders with a different member list/count depending on
  // which filter (role vs. attribute) happens to be active, since each one
  // only keeps the rows matching ITS condition. The active filter only
  // decides whether a group is shown at all (does at least one member match
  // it); once shown, every card lists the group's complete membership, so
  // it's the same single card no matter how you got there. "自分のみ" stays
  // a single unbundled row (your own instance only), per explicit request.
  const displayedTasks = useMemo(() => {
    if (!canFilterView) return tasks

    if (viewFilter === 'mine') {
      return (tasks ?? []).filter((t) => t.assigned_to === profile?.id)
    }

    const matchIds = viewFilter === 'specific' ? (viewFilterProfileId ? [viewFilterProfileId] : []) : (viewFilterProfileIds ?? [])
    const matchSet = new Set(matchIds)
    if (matchSet.size === 0) return []

    const groupsById = new Map()
    for (const t of tasks ?? []) {
      if (!t.task_group_id) continue
      if (!groupsById.has(t.task_group_id)) groupsById.set(t.task_group_id, { ...t, _groupMembers: [] })
      groupsById.get(t.task_group_id)._groupMembers.push(t)
    }

    const result = []
    const shownGroupIds = new Set()
    for (const t of tasks ?? []) {
      if (!matchSet.has(t.assigned_to)) continue
      if (t.task_group_id) {
        if (shownGroupIds.has(t.task_group_id)) continue
        shownGroupIds.add(t.task_group_id)
        result.push(groupsById.get(t.task_group_id))
      } else {
        result.push(t)
      }
    }
    return result
  }, [tasks, canFilterView, viewFilter, profile?.id, viewFilterProfileId, viewFilterProfileIds])

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from('tasks').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  // Deletes every row in a bundled 協働タスク card at once -- a partial
  // delete wouldn't make sense once they're displayed as one task.
  const removeGroup = useMutation({
    mutationFn: async (ids) => {
      const { error } = await supabase.from('tasks').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  function canEdit(task) {
    const members = task._groupMembers ?? [task]
    return isExecutive || members.some((m) => m.assigned_to === user?.id)
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">{isOfficerPlus ? 'タスク' : '自分のタスク'}</h1>
        {isExecutive && (
          <TaskFormDialog
            mode="create"
            members={members}
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

      {canFilterView && (
        <div className="mb-6 space-y-2 rounded-lg border p-3">
          <Label>表示するタスク</Label>
          <Select
            value={viewFilter}
            onValueChange={(v) => {
              setViewFilter(v)
              setViewFilterProfileId('')
              setViewFilterAttrId('')
              setViewFilterValueId('')
              setViewFilterRoleId('')
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">自分のみ</SelectItem>
              <SelectItem value="specific">特定の人</SelectItem>
              <SelectItem value="condition">条件を満たす人</SelectItem>
            </SelectContent>
          </Select>
          {viewFilter === 'specific' && (
            <Select value={viewFilterProfileId} onValueChange={setViewFilterProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="メンバーを選択" />
              </SelectTrigger>
              <SelectContent>
                {members?.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {viewFilter === 'condition' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Select
                  value={viewFilterAttrId}
                  onValueChange={(v) => {
                    setViewFilterAttrId(v)
                    setViewFilterValueId('')
                    setViewFilterRoleId('')
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="属性" />
                  </SelectTrigger>
                  <SelectContent>
                    {viewFilterAttributes?.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={viewFilterValueId}
                  onValueChange={(v) => {
                    setViewFilterValueId(v)
                    setViewFilterRoleId('')
                  }}
                  disabled={!viewFilterAttrId}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="値" />
                  </SelectTrigger>
                  <SelectContent>
                    {viewFilterAttributeValues?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 border-t pt-2">
                <Label className="text-xs text-muted-foreground shrink-0">または役職</Label>
                <Select
                  value={viewFilterRoleId}
                  onValueChange={(v) => {
                    setViewFilterRoleId(v)
                    setViewFilterAttrId('')
                    setViewFilterValueId('')
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="役職" />
                  </SelectTrigger>
                  <SelectContent>
                    {viewFilterClubRoles?.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.label_ja}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!isLoading && (!displayedTasks || displayedTasks.length === 0) && (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <ListTodo className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">タスクはありません</p>
        </Card>
      )}

      <div className="space-y-3">
        {displayedTasks?.map((t, i) => {
          const overdue = isOverdue(t)
          const groupMembers = t._groupMembers ?? [t]
          const isBundled = groupMembers.length > 1
          const assigneeNames = groupMembers.map((m) => m.assignee?.full_name).filter(Boolean).join('、')
          return (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(i, 5) * 0.03 }}>
            <Card className={cn('p-5', t.status === 'done' && 'opacity-60')}>
              <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
                <h3 className={cn('font-bold', t.status === 'done' && 'line-through')}>{t.title}</h3>
                <div className="flex items-center gap-1.5">
                  {isExecutive && t.visibility === 'all' && (
                    <Badge variant="secondary">{VISIBILITY_LABEL.all}</Badge>
                  )}
                  {t.task_group_id && <Badge variant="secondary">協働タスク{isBundled ? `（${groupMembers.length}人）` : ''}</Badge>}
                  <Badge variant="outline" className={PRIORITY_CLASS[t.priority]}>
                    優先度: {PRIORITY_LABEL[t.priority]}
                  </Badge>
                  {isExecutive && (
                    <>
                      {!isBundled && (
                        <button onClick={() => setEditing(t)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          const label = isBundled ? `このタスクを削除しますか？（${groupMembers.length}人分すべて削除されます）` : 'このタスクを削除しますか？'
                          if (confirm(label)) {
                            if (isBundled) removeGroup.mutate(groupMembers.map((m) => m.id))
                            else remove.mutate(t.id)
                          }
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
              {t.description && <p className="mb-2 text-sm text-muted-foreground">{t.description}</p>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {assigneeNames && <span>担当: {assigneeNames}</span>}
                {t.due_at && (
                  <span className={overdue ? 'font-medium text-destructive' : ''}>期限: {formatDueAt(t.due_at)}</span>
                )}
              </div>
              {canEdit(t) && (
                <div className="mt-3 flex gap-2">
                  {STATUS_ORDER.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={t.status === s ? 'default' : 'outline'}
                      onClick={() => setConfirmingStatus({ taskId: t.id, taskTitle: t.title, newStatus: s })}
                    >
                      {STATUS_LABEL[s]}
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
          )
        })}
      </div>

      {editing && <TaskFormDialog mode="edit" task={editing} members={members} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}

      <Dialog open={!!confirmingStatus} onOpenChange={(v) => !v && setConfirmingStatus(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>本当に{STATUS_LABEL[confirmingStatus?.newStatus]}にしますか？</DialogTitle>
            <DialogDescription>
              {STATUS_LABEL[confirmingStatus?.newStatus]}に変更すると、このタスクを見られる人全員にLINEで通知が送信されます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">キャンセル</Button>
            </DialogClose>
            <Button
              disabled={updateStatus.isPending}
              onClick={() => {
                updateStatus.mutate(
                  { id: confirmingStatus.taskId, status: confirmingStatus.newStatus },
                  { onSuccess: () => setConfirmingStatus(null) }
                )
              }}
            >
              {STATUS_LABEL[confirmingStatus?.newStatus]}にする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <details className="group mt-8 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-foreground">
          <span className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            スマホのカレンダーと同期する
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2 space-y-1">
          <p>自分のタスクの期限は、スマホの標準カレンダーアプリに登録して確認することもできます。</p>
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
