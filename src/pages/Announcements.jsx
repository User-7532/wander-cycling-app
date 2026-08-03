import { useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
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

const EMPTY_FORM = { title: '', body: '', category: 'notice', pinned: false }

function AnnouncementFormDialog({ mode, announcement, trigger, open, onOpenChange }) {
  const isPreset = (cat) => Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, cat)
  const [form, setForm] = useState(
    mode === 'edit' ? { ...announcement, category: isPreset(announcement.category) ? announcement.category : 'other' } : EMPTY_FORM
  )
  const [customCategory, setCustomCategory] = useState(mode === 'edit' && !isPreset(announcement.category) ? announcement.category || '' : '')
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const finalCategory = form.category === 'other' && customCategory.trim() ? customCategory.trim() : form.category
      if (mode === 'edit') {
        const { error } = await supabase
          .from('announcements')
          .update({ title: form.title, body: form.body, category: finalCategory, pinned: form.pinned })
          .eq('id', announcement.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('announcements').insert({ title: form.title, body: form.body, category: finalCategory, pinned: form.pinned })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : 'お知らせを投稿しました')
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      if (mode === 'create') {
        setForm(EMPTY_FORM)
        setCustomCategory('')
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
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {a.pinned && <Pin className="h-3.5 w-3.5 text-primary" />}
                  <h3 className="font-bold">{a.title}</h3>
                </div>
                <div className="flex items-center gap-1.5">
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
