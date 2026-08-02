import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Banknote, CircleCheck, CircleDollarSign, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
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
import { cn } from '@/lib/utils'

const DIRECTION_LABEL = { income: '収入', expense: '支出' }
const EMPTY_RECORD = { entry_date: '', direction: 'expense', category: '', amount_jpy: '', description: '' }

function RecordFormDialog({ mode, record, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(
    mode === 'edit' ? { ...record, amount_jpy: String(record.amount_jpy) } : EMPTY_RECORD
  )
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        entry_date: form.entry_date,
        direction: form.direction,
        category: form.category,
        amount_jpy: Number(form.amount_jpy),
        description: form.description || null,
      }
      const { error } =
        mode === 'edit' ? await supabase.from('financial_records').update(payload).eq('id', record.id) : await supabase.from('financial_records').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : '記録を追加しました')
      queryClient.invalidateQueries({ queryKey: ['financial_records'] })
      if (mode === 'create') setForm(EMPTY_RECORD)
      onOpenChange(false)
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? '会計記録を編集' : '会計記録を追加'}</DialogTitle>
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
              <Label htmlFor="f-date">日付</Label>
              <Input id="f-date" type="date" required value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>区分</Label>
              <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">収入</SelectItem>
                  <SelectItem value="expense">支出</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-category">項目</Label>
            <Input id="f-category" required placeholder="例: 部費、備品購入" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-amount">金額（円）</Label>
            <Input id="f-amount" type="number" required min="0" value={form.amount_jpy} onChange={(e) => setForm({ ...form, amount_jpy: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-desc">メモ</Label>
            <Input id="f-desc" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {mode === 'edit' ? '保存する' : '追加する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FinancialLedger() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: records, isLoading } = useQuery({
    queryKey: ['financial_records'],
    queryFn: async () => {
      const { data, error } = await supabase.from('financial_records').select('*').order('entry_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('financial_records').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['financial_records'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  const totalIncome = records?.filter((r) => r.direction === 'income').reduce((sum, r) => sum + r.amount_jpy, 0) ?? 0
  const totalExpense = records?.filter((r) => r.direction === 'expense').reduce((sum, r) => sum + r.amount_jpy, 0) ?? 0

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">収入合計</p>
          <p className="text-xl font-black text-primary">¥{totalIncome.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">支出合計</p>
          <p className="text-xl font-black text-destructive">¥{totalExpense.toLocaleString()}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">残高</p>
          <p className="text-xl font-black">¥{(totalIncome - totalExpense).toLocaleString()}</p>
        </Card>
      </div>

      <div className="mb-3 flex justify-end">
        <RecordFormDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              記録を追加
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
            <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', r.direction === 'income' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive')}>
              <CircleDollarSign className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">{r.category}</p>
              <p className="text-xs text-muted-foreground">
                {r.entry_date} {r.description && `・${r.description}`}
              </p>
            </div>
            <p className={cn('font-bold', r.direction === 'income' ? 'text-primary' : 'text-destructive')}>
              {r.direction === 'income' ? '+' : '-'}¥{r.amount_jpy.toLocaleString()}
            </p>
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

      {editing && <RecordFormDialog mode="edit" record={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  )
}

function MembershipFeesAdmin() {
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState('')
  const [amount, setAmount] = useState('3000')

  const { data: members } = useQuery({
    queryKey: ['profiles', 'for-fees'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return data
    },
  })

  const { data: fees } = useQuery({
    queryKey: ['membership_fees', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('membership_fees').select('*')
      if (error) throw error
      return data
    },
  })

  const createForAll = useMutation({
    mutationFn: async () => {
      if (!members || !period) return
      const rows = members.map((m) => ({ profile_id: m.id, period, amount_jpy: Number(amount), status: 'unpaid' }))
      const { error } = await supabase.from('membership_fees').upsert(rows, { onConflict: 'profile_id,period', ignoreDuplicates: true })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('全員分の会費を作成しました')
      queryClient.invalidateQueries({ queryKey: ['membership_fees'] })
    },
    onError: (err) => toast.error(`作成に失敗しました: ${err.message}`),
  })

  const togglePaid = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase
        .from('membership_fees')
        .update({ status, paid_at: status === 'paid' ? new Date().toISOString().slice(0, 10) : null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membership_fees'] }),
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  const feesByProfile = new Map((fees ?? []).map((f) => [f.profile_id, f]))

  return (
    <div>
      <Card className="mb-4 p-4">
        <p className="mb-2 text-sm font-bold">新しい期の会費を全員分作成</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="period" className="text-xs">
              期（例: 2026-spring）
            </Label>
            <Input id="period" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="amount" className="text-xs">
              金額（円）
            </Label>
            <Input id="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" />
          </div>
          <Button size="sm" onClick={() => createForAll.mutate()} disabled={!period || createForAll.isPending}>
            作成
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        {members?.map((m) => {
          const fee = feesByProfile.get(m.id)
          return (
            <Card key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-bold">{m.full_name}</p>
                {fee ? (
                  <p className="text-xs text-muted-foreground">
                    {fee.period}・¥{fee.amount_jpy.toLocaleString()}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">未作成</p>
                )}
              </div>
              {fee && (
                <Button
                  size="sm"
                  variant={fee.status === 'paid' ? 'default' : 'outline'}
                  onClick={() => togglePaid.mutate({ id: fee.id, status: fee.status === 'paid' ? 'unpaid' : 'paid' })}
                >
                  <CircleCheck className="h-3.5 w-3.5" />
                  {fee.status === 'paid' ? '支払済み' : '未払い'}
                </Button>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function MyFeeStatus({ user }) {
  const { data: fees, isLoading } = useQuery({
    queryKey: ['membership_fees', 'mine', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('membership_fees').select('*').eq('profile_id', user.id).order('period', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black tracking-tight">
        <Wallet className="h-6 w-6 text-primary" />
        会費
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">自分の会費の支払い状況</p>

      {isLoading && <Skeleton className="h-16 w-full" />}
      {!isLoading && (!fees || fees.length === 0) && (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">まだ会費の記録がありません</Card>
      )}
      <div className="space-y-2">
        {fees?.map((f) => (
          <Card key={f.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-bold">{f.period}</p>
              <p className="text-xs text-muted-foreground">¥{f.amount_jpy.toLocaleString()}</p>
            </div>
            <Badge variant={f.status === 'paid' ? 'secondary' : 'outline'}>{f.status === 'paid' ? '支払済み' : '未払い'}</Badge>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function Finance() {
  const { user, isExecutive } = useOutletContext()
  const [tab, setTab] = useState('ledger')

  if (!isExecutive) return <MyFeeStatus user={user} />

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black tracking-tight">
        <Banknote className="h-6 w-6 text-primary" />
        会計・会費
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">執行部限定の会計管理ページ</p>

      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === 'ledger' ? 'default' : 'outline'} onClick={() => setTab('ledger')}>
          収支
        </Button>
        <Button size="sm" variant={tab === 'fees' ? 'default' : 'outline'} onClick={() => setTab('fees')}>
          会費
        </Button>
      </div>

      {tab === 'ledger' ? <FinancialLedger /> : <MembershipFeesAdmin />}
    </div>
  )
}
