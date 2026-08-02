import { useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { ListTodo, Pencil, Plus, Trash2 } from 'lucide-react'
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
const EMPTY_FORM = { title: '', description: '', assigned_to: '', priority: 'medium', due_date: '' }

function TaskFormDialog({ mode, task, members, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(
    mode === 'edit'
      ? { title: task.title, description: task.description || '', assigned_to: task.assigned_to || '', priority: task.priority, due_date: task.due_date || '' }
      : EMPTY_FORM
  )
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description || null,
        assigned_to: form.assigned_to || null,
        priority: form.priority,
        due_date: form.due_date || null,
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
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="t-title">タイトル</Label>
            <Input id="t-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc">詳細</Label>
            <Textarea id="t-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>担当者</Label>
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
              <Label htmlFor="t-due">期限</Label>
              <Input id="t-due" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {mode === 'edit' ? '保存する' : '追加する'}
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
        .order('due_date', { ascending: true, nullsFirst: false })
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
        {tasks?.map((t, i) => (
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
                {t.due_date && <span>期限: {t.due_date}</span>}
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
        ))}
      </div>

      {editing && <TaskFormDialog mode="edit" task={editing} members={members} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  )
}
