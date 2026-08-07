import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { ExternalLink, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const SUGGESTED_CATEGORIES = ['引継ぎ資料', '安全講習', '旅行Tips', '公式アカウント', 'お役立ちリンク', 'その他']
const EMPTY_FORM = { category: SUGGESTED_CATEGORIES[0], label: '', url: '' }

function LinkFormDialog({ mode, link, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(mode === 'edit' ? { category: link.category, label: link.label, url: link.url } : EMPTY_FORM)
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const { error } = mode === 'edit' ? await supabase.from('external_links').update(form).eq('id', link.id) : await supabase.from('external_links').insert(form)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : 'リンクを追加しました')
      queryClient.invalidateQueries({ queryKey: ['external_links'] })
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
          <DialogTitle>{mode === 'edit' ? 'リンクを編集' : 'リンクを追加'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label>カテゴリ</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUGGESTED_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-label">タイトル</Label>
            <Input id="r-label" required placeholder="例: 引継ぎ資料フォルダ（Google Drive）" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-url">URL</Label>
            <Input id="r-url" type="url" required placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {mode === 'edit' ? '保存する' : '追加する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Resources() {
  const { isExecutive } = useOutletContext()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: links, isLoading } = useQuery({
    queryKey: ['external_links'],
    queryFn: async () => {
      const { data, error } = await supabase.from('external_links').select('*').eq('is_active', true).order('category').order('sort_order')
      if (error) throw error
      return data
    },
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('external_links').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['external_links'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  const grouped = useMemo(() => {
    const map = new Map()
    for (const l of links ?? []) {
      if (!map.has(l.category)) map.set(l.category, [])
      map.get(l.category).push(l)
    }
    return [...map.entries()]
  }, [links])

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">資料</h1>
          <p className="text-sm text-muted-foreground">引継ぎ資料・安全講習・旅行Tipsなどへのリンク集</p>
        </div>
        {isExecutive && (
          <LinkFormDialog
            mode="create"
            open={createOpen}
            onOpenChange={setCreateOpen}
            trigger={
              <Button size="icon" className="h-10 w-10 shrink-0 rounded-full">
                <Plus className="h-5 w-5" />
              </Button>
            }
          />
        )}
      </div>

      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && grouped.length === 0 && (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">
          まだリンクが登録されていません。{isExecutive ? '右上の + から追加してください。' : ''}
        </Card>
      )}

      <div className="space-y-6">
        {grouped.map(([category, items]) => (
          <div key={category}>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-muted-foreground">
              <FolderOpen className="h-4 w-4" />
              {category}
            </div>
            <Card className="divide-y overflow-hidden p-0">
              {items.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center gap-2 text-sm font-medium hover:text-primary">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {l.label}
                  </a>
                  {isExecutive && (
                    <>
                      <button onClick={() => setEditing(l)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('このリンクを削除しますか？')) remove.mutate(l.id)
                        }}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                        aria-label="削除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>

      {editing && <LinkFormDialog mode="edit" link={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  )
}
