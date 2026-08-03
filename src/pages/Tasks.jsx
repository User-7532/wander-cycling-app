import { useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useOutletContext } from 'react-router-dom'
import { CalendarClock, ChevronDown, ListTodo, Pencil, Plus, Trash2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'

const STATUS_LABEL = { todo: '未着手', in_progress: '進行中', done: '完了' }
const STATUS_ORDER = ['todo', 'in_progress', 'done']
const PRIORITY_LABEL = { low: '低', medium: '中', high: '高' }
const PRIORITY_CLASS = {
  high: 'border-destructive/40 text-destructive',
  medium: 'border-primary/40 text-primary',
  low: 'border-muted-foreground/30 text-muted-foreground',
}
const EMPTY_FORM = { title: '', description: '', assigned_to: '', priority: 'medium', due_at: '' }

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

const EMPTY_FILTER = { attributeId: '', valueId: '' }

function TaskFormDialog({ mode, task, members, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(
    mode === 'edit'
      ? { title: task.title, description: task.description || '', assigned_to: task.assigned_to || '', priority: task.priority, due_at: toLocalInputValue(task.due_at) }
      : EMPTY_FORM
  )
  const [bulkMode, setBulkMode] = useState(false)
  const [filters, setFilters] = useState([{ ...EMPTY_FILTER }])
  // selectedIds is the actual bulk-create target group. It is NOT derived
  // live from the filter condition below -- the filter condition is a
  // preview of who an "適用" click would affect. Clicking apply flips
  // (XORs) the currently-matched people's membership in selectedIds, so
  // e.g. "全員選択" then applying a "3年" filter deselects exactly the
  // 3年 people, leaving everyone else selected.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description || null,
        assigned_to: form.assigned_to || null,
        priority: form.priority,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      }
      const { error } = mode === 'edit' ? await supabase.from('tasks').update(payload).eq('id', task.id) : await supabase.from('tasks').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : 'タスクを追加しました')
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      if (mode === 'create') setForm(EMPTY_FORM)
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
    enabled: mode === 'create' && bulkMode,
  })

  const { data: attributeValues } = useQuery({
    queryKey: ['member_attribute_values'],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, attribute_id, value').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: mode === 'create' && bulkMode,
  })

  const validFilters = filters.filter((f) => f.attributeId && f.valueId)
  const activeValueIds = validFilters.map((f) => f.valueId)
  const filterKey = activeValueIds.join(',')

  const { data: matchedProfiles, isFetching: matchingLoading } = useQuery({
    queryKey: ['bulk-task-candidates', filterKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_attribute_values')
        .select('profile_id, attribute_value_id, profile:profiles(id, full_name)')
        .in('attribute_value_id', activeValueIds)
      if (error) throw error
      const requiredIds = new Set(activeValueIds)
      const byProfile = new Map()
      for (const row of data) {
        if (!row.profile) continue
        const entry = byProfile.get(row.profile_id) || { profile: row.profile, values: new Set() }
        entry.values.add(row.attribute_value_id)
        byProfile.set(row.profile_id, entry)
      }
      return [...byProfile.values()]
        .filter((entry) => [...requiredIds].every((id) => entry.values.has(id)))
        .map((entry) => entry.profile)
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ja'))
    },
    enabled: mode === 'create' && bulkMode && validFilters.length > 0 && validFilters.length === filters.length,
  })

  // selectedProfiles is resolved against the full member roster (not just
  // matchedProfiles) so that people toggled in under an earlier filter
  // combination stay visible/selected even after the filter condition
  // above changes.
  const selectedProfiles = (members ?? []).filter((m) => selectedIds.has(m.id))

  function updateFilter(idx, patch) {
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }
  function addFilter() {
    setFilters((prev) => [...prev, { ...EMPTY_FILTER }])
  }
  function removeFilter(idx) {
    setFilters((prev) => prev.filter((_, i) => i !== idx))
  }
  function toggleProfile(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function applyFilterToggle() {
    const ids = (matchedProfiles ?? []).map((p) => p.id)
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

  const bulkSave = useMutation({
    mutationFn: async () => {
      const rows = selectedProfiles.map((p) => ({
        title: form.title,
        description: form.description || null,
        assigned_to: p.id,
        priority: form.priority,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      }))
      const { error } = await supabase.from('tasks').insert(rows)
      if (error) throw error
      return rows.length
    },
    onSuccess: (count) => {
      toast.success(`${count}件のタスクを追加しました`)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setForm(EMPTY_FORM)
      setBulkMode(false)
      setFilters([{ ...EMPTY_FILTER }])
      setSelectedIds(new Set())
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
              {filters.map((f, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={f.attributeId} onValueChange={(v) => updateFilter(idx, { attributeId: v, valueId: '' })}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="属性" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributes?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={f.valueId} onValueChange={(v) => updateFilter(idx, { valueId: v })} disabled={!f.attributeId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="値" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributeValues
                        ?.filter((v) => v.attribute_id === f.attributeId)
                        .map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.value}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {filters.length > 1 && (
                    <button type="button" onClick={() => removeFilter(idx)} className="text-muted-foreground transition-colors hover:text-destructive" aria-label="条件を削除">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={addFilter}>
                  条件を追加（AND）
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={!matchedProfiles?.length} onClick={applyFilterToggle}>
                  この条件で選択を切替
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                条件に一致する人の選択状態を反転します（選択中なら解除、未選択なら選択）。「全員選択」後に条件を切り替えると、その条件の人だけ除外できます。
              </p>
              {matchingLoading && <p className="text-xs text-muted-foreground">検索中...</p>}
              {!matchingLoading && validFilters.length > 0 && matchedProfiles?.length === 0 && (
                <p className="text-xs text-muted-foreground">該当する部員がいません</p>
              )}

              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between">
                  <Label>対象者（{selectedProfiles.length}人選択中）</Label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={selectAllProfiles}>
                      全員選択
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={deselectAllProfiles}>
                      全員解除
                    </Button>
                  </div>
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {members?.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleProfile(m.id)} />
                      {m.full_name}
                    </label>
                  ))}
                </div>
              </div>
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
            disabled={save.isPending || bulkSave.isPending || (mode === 'create' && bulkMode && selectedProfiles.length === 0)}
          >
            {mode === 'edit' ? '保存する' : mode === 'create' && bulkMode ? `${selectedProfiles.length}人にタスクを作成` : '追加する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Tasks() {
  const { user, profile } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const isOfficerPlus = ['executive', 'officer'].includes(profile?.club_roles?.tier)
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

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
    enabled: isExecutive,
  })

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

  function canEdit(task) {
    return isExecutive || task.assigned_to === user?.id
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

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!isLoading && (!tasks || tasks.length === 0) && (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <ListTodo className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">タスクはありません</p>
        </Card>
      )}

      <div className="space-y-3">
        {tasks?.map((t, i) => {
          const overdue = isOverdue(t)
          return (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(i, 5) * 0.03 }}>
            <Card className={cn('p-5', t.status === 'done' && 'opacity-60')}>
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <h3 className={cn('font-bold', t.status === 'done' && 'line-through')}>{t.title}</h3>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={PRIORITY_CLASS[t.priority]}>
                    優先度: {PRIORITY_LABEL[t.priority]}
                  </Badge>
                  {isExecutive && (
                    <>
                      <button onClick={() => setEditing(t)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('このタスクを削除しますか？')) remove.mutate(t.id)
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
                {t.assignee?.full_name && <span>担当: {t.assignee.full_name}</span>}
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
                      onClick={() => updateStatus.mutate({ id: t.id, status: s })}
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
