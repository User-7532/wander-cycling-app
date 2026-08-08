import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { PiggyBank, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

// Built-in starting categories. category is plain text (the label itself,
// e.g. '交通費') rather than a fixed enum key, so these and any
// self-added custom category (personal_expense_categories, 0072) are
// handled identically by the picker below.
const DEFAULT_CATEGORIES = ['交通費', '宿泊費', '食費', '装備・道具', '部費・会費', 'その他']
const ADD_CATEGORY_SENTINEL = '__add_category__'

function todayLocal() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const EMPTY_FORM = { entry_date: todayLocal(), category: '', amount_jpy: '', description: '' }

// 上位%（シャバさ度）に応じたひとことラベル -- ネタ機能なので大真面目にしない。
function tierLabel(percentile) {
  if (percentile <= 10) return '仙人級の節約家🧘'
  if (percentile <= 30) return '堅実な倹約家💰'
  if (percentile <= 60) return '普通の部員🚴'
  if (percentile <= 85) return 'そこそこ使ってる派💸'
  return '太っ腹スポンサー枠🎉'
}

function ExpenseFormDialog({ mode, record, userId, categories, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(mode === 'edit' ? { ...record, amount_jpy: String(record.amount_jpy) } : EMPTY_FORM)
  const [addingCategory, setAddingCategory] = useState(false)
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const category = form.category.trim()
      const payload = {
        entry_date: form.entry_date,
        category,
        amount_jpy: Number(form.amount_jpy),
        description: form.description || null,
      }
      const { error } =
        mode === 'edit'
          ? await supabase.from('personal_expenses').update(payload).eq('id', record.id)
          : await supabase.from('personal_expenses').insert({ ...payload, profile_id: userId })
      if (error) throw error

      // Remember a newly-typed category so it shows up in the picker next
      // time too, not just this once.
      if (!categories.includes(category)) {
        await supabase.from('personal_expense_categories').upsert({ profile_id: userId, label: category }, { onConflict: 'profile_id,label', ignoreDuplicates: true })
      }
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : '記録を追加しました')
      queryClient.invalidateQueries({ queryKey: ['personal_expenses'] })
      queryClient.invalidateQueries({ queryKey: ['personal_expense_categories'] })
      queryClient.invalidateQueries({ queryKey: ['my_expense_rank'] })
      if (mode === 'create') {
        setForm(EMPTY_FORM)
        setAddingCategory(false)
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
          <DialogTitle>{mode === 'edit' ? '支出を編集' : '支出を記録'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pe-date">日付</Label>
              <Input id="pe-date" type="date" required value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>カテゴリ</Label>
              {addingCategory ? (
                <Input
                  autoFocus
                  required
                  placeholder="新しいカテゴリ名"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              ) : (
                <Select
                  value={form.category}
                  onValueChange={(v) => {
                    if (v === ADD_CATEGORY_SENTINEL) {
                      setAddingCategory(true)
                      setForm({ ...form, category: '' })
                    } else {
                      setForm({ ...form, category: v })
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    <SelectItem value={ADD_CATEGORY_SENTINEL}>＋ 新しいカテゴリを追加</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pe-amount">金額（円）</Label>
            <Input id="pe-amount" type="number" required min="0" value={form.amount_jpy} onChange={(e) => setForm({ ...form, amount_jpy: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pe-desc">メモ（任意）</Label>
            <Input id="pe-desc" placeholder="例: 合宿の交通費" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending || !form.category.trim()}>
            {mode === 'edit' ? '保存する' : '追加する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function PersonalExpenses() {
  const { user } = useOutletContext()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: records, isLoading } = useQuery({
    queryKey: ['personal_expenses', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('personal_expenses').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  const { data: customCategories } = useQuery({
    queryKey: ['personal_expense_categories', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('personal_expense_categories').select('label').order('created_at')
      if (error) throw error
      return data.map((r) => r.label)
    },
    enabled: !!user,
  })
  const categories = [...DEFAULT_CATEGORIES, ...(customCategories ?? []).filter((c) => !DEFAULT_CATEGORIES.includes(c))]

  // Never returns anyone else's amount -- see my_expense_rank() (0071):
  // security definer internally, but filtered to auth.uid() before
  // returning, so only the caller's own total/rank/field-size ever leaves it.
  const { data: rank } = useQuery({
    queryKey: ['my_expense_rank', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_expense_rank')
      if (error) throw error
      return data?.[0] ?? null
    },
    enabled: !!user,
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('personal_expenses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personal_expenses'] })
      queryClient.invalidateQueries({ queryKey: ['my_expense_rank'] })
    },
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  const totalAllTime = records?.reduce((sum, r) => sum + r.amount_jpy, 0) ?? 0
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const totalThisMonth = records?.filter((r) => r.entry_date.startsWith(monthPrefix)).reduce((sum, r) => sum + r.amount_jpy, 0) ?? 0

  const categoryTotalsMap = new Map()
  for (const r of records ?? []) {
    categoryTotalsMap.set(r.category, (categoryTotalsMap.get(r.category) ?? 0) + r.amount_jpy)
  }
  const categoryTotals = [...categoryTotalsMap.entries()].map(([category, total]) => ({ category, total }))
  const maxCategoryTotal = Math.max(1, ...categoryTotals.map((c) => c.total))

  const percentile = rank ? Math.round((100 * Number(rank.frugal_rank)) / Number(rank.total_ranked)) : null

  const shareText = rank
    ? `🚴 ワンダーサイクリング家計簿\n累計支出: ¥${totalAllTime.toLocaleString()}\n節約部門: ${rank.frugal_rank}位 / ${rank.total_ranked}人中（上位${percentile}%）\n${tierLabel(percentile)}`
    : ''

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black tracking-tight">
        <PiggyBank className="h-6 w-6 text-primary" />
        マイ家計簿
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">ワンダーサイクリングで使ったお金を記録（自分専用・他の人には見えません）</p>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">今月の支出</p>
          <p className="text-xl font-black text-destructive">¥{totalThisMonth.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">累計支出</p>
          <p className="text-xl font-black">¥{totalAllTime.toLocaleString()}</p>
        </Card>
      </div>

      {rank && (
        <Card className="mb-4 space-y-2 border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">シャバさ度（節約部門）</p>
            <Badge variant="secondary">{tierLabel(percentile)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            部内 {rank.total_ranked}人中 <span className="font-bold text-foreground">{rank.frugal_rank}位</span>（上位{percentile}%）— 具体的な金額は他の人には分かりません
          </p>
          <a href={`https://line.me/R/msg/text/?${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
            <Button type="button" size="sm" variant="outline">
              <Send className="h-3.5 w-3.5" />
              LINEでシェア
            </Button>
          </a>
        </Card>
      )}

      {categoryTotals.length > 0 && (
        <Card className="mb-4 space-y-2 p-4">
          <p className="text-sm font-bold">カテゴリ別（累計）</p>
          {categoryTotals
            .sort((a, b) => b.total - a.total)
            .map((c) => (
              <div key={c.category} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{c.category}</span>
                  <span className="font-medium">¥{c.total.toLocaleString()}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(100 * c.total) / maxCategoryTotal}%` }} />
                </div>
              </div>
            ))}
        </Card>
      )}

      <div className="mb-3 flex justify-end">
        <ExpenseFormDialog
          mode="create"
          userId={user?.id}
          categories={categories}
          open={createOpen}
          onOpenChange={setCreateOpen}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              支出を記録
            </Button>
          }
        />
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}
      {!isLoading && (!records || records.length === 0) && (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">まだ記録がありません</Card>
      )}

      <div className="space-y-2">
        {records?.map((r) => (
          <Card key={r.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <p className="text-sm font-bold">{r.category}</p>
              <p className="text-xs text-muted-foreground">
                {r.entry_date} {r.description && `・${r.description}`}
              </p>
            </div>
            <p className="font-bold text-destructive">¥{r.amount_jpy.toLocaleString()}</p>
            <button onClick={() => setEditing(r)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                if (confirm('この記録を削除しますか？')) remove.mutate(r.id)
              }}
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label="削除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Card>
        ))}
      </div>

      {editing && (
        <ExpenseFormDialog mode="edit" record={editing} userId={user?.id} categories={categories} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />
      )}
    </div>
  )
}
