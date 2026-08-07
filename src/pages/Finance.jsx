import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Banknote, Camera, CircleCheck, CircleDollarSign, Pencil, Plus, Receipt, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { safeStorageFilename } from '@/lib/storage'
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
const REIMBURSEMENT_STATUS_LABEL = { pending: '審査待ち', approved: '承認済み', paid: '支払済み', rejected: '却下' }
const REIMBURSEMENT_STATUS_VARIANT = { pending: 'outline', approved: 'secondary', paid: 'default', rejected: 'outline' }

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
            <Label htmlFor="f-desc">メモ（任意）</Label>
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

function ReceiptLink({ path }) {
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 60)
    setLoading(false)
    if (error) {
      toast.error('領収書の取得に失敗しました')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <button type="button" onClick={open} disabled={loading} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      <Receipt className="h-3.5 w-3.5" />
      領収書を見る
    </button>
  )
}

function SubmitReimbursementDialog({ userId, trigger, open, onOpenChange }) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const queryClient = useQueryClient()

  const submit = useMutation({
    mutationFn: async () => {
      let receiptPath = null
      if (file) {
        receiptPath = `${userId}/${safeStorageFilename(file.name)}`
        const { error: uploadError } = await supabase.storage.from('receipts').upload(receiptPath, file)
        if (uploadError) throw uploadError
      }
      const { error } = await supabase
        .from('reimbursement_requests')
        .insert({ submitted_by: userId, amount_jpy: Number(amount), description, receipt_path: receiptPath })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('立替払いを申請しました')
      queryClient.invalidateQueries({ queryKey: ['reimbursement_requests'] })
      setAmount('')
      setDescription('')
      setFile(null)
      onOpenChange(false)
    },
    onError: (err) => toast.error(`申請に失敗しました: ${err.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>立替払いを申請</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="r-amount">金額（円）</Label>
            <Input id="r-amount" type="number" required min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-desc">内容</Label>
            <Input id="r-desc" required placeholder="例: 合宿の食材費" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-receipt">領収書の写真（任意）</Label>
            <label
              htmlFor="r-receipt"
              className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input text-xs text-muted-foreground hover:bg-muted/50"
            >
              <Camera className="h-5 w-5" />
              {file ? file.name : 'タップして写真を選択'}
            </label>
            <input id="r-receipt" type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <Button type="submit" className="w-full" disabled={submit.isPending}>
            申請する
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MyReimbursements({ userId }) {
  const [createOpen, setCreateOpen] = useState(false)

  const { data: requests, isLoading } = useQuery({
    queryKey: ['reimbursement_requests', 'mine', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reimbursement_requests')
        .select('*')
        .eq('submitted_by', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!userId,
  })

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Receipt className="h-5 w-5 text-primary" />
          立替払い
        </h2>
        <SubmitReimbursementDialog
          userId={userId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          trigger={
            <Button size="sm">
              <Plus className="h-4 w-4" />
              申請する
            </Button>
          }
        />
      </div>

      {isLoading && <Skeleton className="h-16 w-full" />}
      {!isLoading && (!requests || requests.length === 0) && (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">まだ申請はありません</Card>
      )}
      <div className="space-y-2">
        {requests?.map((r) => (
          <Card key={r.id} className="px-4 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-sm font-bold">{r.description}</p>
              <Badge variant={REIMBURSEMENT_STATUS_VARIANT[r.status]}>{REIMBURSEMENT_STATUS_LABEL[r.status]}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">¥{r.amount_jpy.toLocaleString()}</p>
              {r.receipt_path && <ReceiptLink path={r.receipt_path} />}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function ReimbursementAdmin({ userId }) {
  const [createOpen, setCreateOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: requests, isLoading } = useQuery({
    queryKey: ['reimbursement_requests', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reimbursement_requests')
        .select('*, submitter:profiles!reimbursement_requests_submitted_by_fkey(full_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase
        .from('reimbursement_requests')
        .update({ status, reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reimbursement_requests'] }),
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">部員からの立替払い申請を確認・処理します</p>
        <SubmitReimbursementDialog
          userId={userId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          trigger={
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4" />
              自分も申請する
            </Button>
          }
        />
      </div>

      {isLoading && <Skeleton className="h-16 w-full" />}
      {!isLoading && (!requests || requests.length === 0) && (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">まだ申請はありません</Card>
      )}
      <div className="space-y-2">
        {requests?.map((r) => (
          <Card key={r.id} className="px-4 py-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-sm font-bold">
                {r.submitter?.full_name} ・ {r.description}
              </p>
              <Badge variant={REIMBURSEMENT_STATUS_VARIANT[r.status]}>{REIMBURSEMENT_STATUS_LABEL[r.status]}</Badge>
            </div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">¥{r.amount_jpy.toLocaleString()}</p>
              {r.receipt_path && <ReceiptLink path={r.receipt_path} />}
            </div>
            {r.status !== 'paid' && (
              <div className="flex gap-2">
                {r.status === 'pending' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: r.id, status: 'approved' })}>
                      承認
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: r.id, status: 'rejected' })}>
                      却下
                    </Button>
                  </>
                )}
                {r.status === 'approved' && (
                  <Button size="sm" onClick={() => updateStatus.mutate({ id: r.id, status: 'paid' })}>
                    支払済みにする
                  </Button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function Finance() {
  const { user, isExecutive } = useOutletContext()
  const [tab, setTab] = useState('ledger')

  if (!isExecutive) {
    return (
      <div className="mx-auto max-w-2xl space-y-8 px-5 py-8">
        <MyFeeStatus user={user} />
        <MyReimbursements userId={user.id} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black tracking-tight">
        <Banknote className="h-6 w-6 text-primary" />
        会計・会費
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">アプリ管理者限定の会計管理ページ</p>

      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === 'ledger' ? 'default' : 'outline'} onClick={() => setTab('ledger')}>
          収支
        </Button>
        <Button size="sm" variant={tab === 'fees' ? 'default' : 'outline'} onClick={() => setTab('fees')}>
          会費
        </Button>
        <Button size="sm" variant={tab === 'reimbursement' ? 'default' : 'outline'} onClick={() => setTab('reimbursement')}>
          立替払い
        </Button>
      </div>

      {tab === 'ledger' && <FinancialLedger />}
      {tab === 'fees' && <MembershipFeesAdmin />}
      {tab === 'reimbursement' && <ReimbursementAdmin userId={user.id} />}
    </div>
  )
}
