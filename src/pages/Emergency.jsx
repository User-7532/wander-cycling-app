import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Pencil, Phone, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// This page is intentionally free of entrance/stagger animation: it needs to
// be instantly readable in a real emergency, not decorated.

const CATEGORY_LABEL = { contact: '緊急連絡先', procedure: '対応手順', hospital: '病院', alert: '注意事項', other: 'その他' }
const PRIORITY_STYLE = {
  high: 'border-destructive bg-destructive/5',
  medium: 'border-amber-400 bg-amber-50',
  low: 'border-border bg-card',
}
const EMPTY_FORM = { title: '', body: '', category: 'contact', priority: 'high', contact: '' }

function EmergencyFormDialog({ mode, item, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(mode === 'edit' ? { ...item, contact: item.contact || '' } : EMPTY_FORM)
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const payload = { title: form.title, body: form.body, category: form.category, priority: form.priority, contact: form.contact || null }
      const { error } = mode === 'edit' ? await supabase.from('emergency_info').update(payload).eq('id', item.id) : await supabase.from('emergency_info').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : '緊急連絡情報を追加しました')
      queryClient.invalidateQueries({ queryKey: ['emergency_info'] })
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
          <DialogTitle>{mode === 'edit' ? '緊急連絡情報を編集' : '緊急連絡情報を追加'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="e-title">タイトル</Label>
            <Input id="e-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-body">内容</Label>
            <Textarea id="e-body" required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-contact">電話番号（任意）</Label>
            <Input id="e-contact" type="tel" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Label>優先度</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="low">低</SelectItem>
                </SelectContent>
              </Select>
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

export default function Emergency() {
  const { profile } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: items, isLoading } = useQuery({
    queryKey: ['emergency_info'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emergency_info')
        .select('*')
        .order('priority', { ascending: true })
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data
    },
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('emergency_info').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emergency_info'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-7 w-7 text-destructive" />
          <h1 className="text-2xl font-black tracking-tight text-destructive">緊急連絡</h1>
        </div>
        {isExecutive && (
          <EmergencyFormDialog
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

      {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

      {!isLoading && (!items || items.length === 0) && (
        <Card className="border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            緊急連絡情報はまだ登録されていません。{isExecutive ? '右上の + から追加してください。' : ''}
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {items?.map((item) => (
          <div key={item.id} className={cn('rounded-2xl border-2 p-5', PRIORITY_STYLE[item.priority] || PRIORITY_STYLE.low)}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">{item.title}</h3>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {CATEGORY_LABEL[item.category] || item.category}
                </span>
                {isExecutive && (
                  <>
                    <button onClick={() => setEditing(item)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('この緊急連絡情報を削除しますか？')) remove.mutate(item.id)
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
            <p className="whitespace-pre-wrap text-sm">{item.body}</p>
            {item.contact && (
              <a
                href={`tel:${item.contact}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground"
              >
                <Phone className="h-4 w-4" />
                {item.contact} に発信
              </a>
            )}
          </div>
        ))}
      </div>

      {editing && <EmergencyFormDialog mode="edit" item={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  )
}
