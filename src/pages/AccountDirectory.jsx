import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
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

const MIN_TIER_LABEL = { officer: '担当者以上', executive: 'アプリ管理者のみ' }
const EMPTY_FORM = { service_name: '', login_id: '', notes: '', min_tier: 'officer', secret_value: '', verification_contact: '' }

function EntryFormDialog({ mode, entry, trigger, open, onOpenChange }) {
  const [form, setForm] = useState(mode === 'edit' ? { ...entry, secret_value: '' } : EMPTY_FORM)
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('account-secret', {
        body: {
          action: 'set',
          entry_id: mode === 'edit' ? entry.id : null,
          service_name: form.service_name,
          login_id: form.login_id,
          notes: form.notes,
          min_tier: form.min_tier,
          secret_value: form.secret_value || undefined,
          verification_contact: form.verification_contact,
        },
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? '更新しました' : 'アカウントを追加しました')
      queryClient.invalidateQueries({ queryKey: ['account_directory'] })
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
          <DialogTitle>{mode === 'edit' ? 'アカウントを編集' : 'アカウントを追加'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="s-name">サービス名</Label>
            <Input id="s-name" required placeholder="例: 部のGmail" value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-login">ログインID / メールアドレス（任意）</Label>
            <Input id="s-login" value={form.login_id || ''} onChange={(e) => setForm({ ...form, login_id: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-secret">パスワード{mode === 'edit' ? '（変更する場合のみ入力）' : '（任意）'}</Label>
            <Input id="s-secret" type="password" value={form.secret_value} onChange={(e) => setForm({ ...form, secret_value: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-verify">認証先メール / 電話番号（2段階認証・復旧用、任意）</Label>
            <Input
              id="s-verify"
              value={form.verification_contact || ''}
              onChange={(e) => setForm({ ...form, verification_contact: e.target.value })}
              placeholder="例: 部のGmail、または個人の携帯番号"
            />
          </div>
          <div className="space-y-1.5">
            <Label>閲覧できる範囲</Label>
            <Select value={form.min_tier} onValueChange={(v) => setForm({ ...form, min_tier: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="officer">担当者以上</SelectItem>
                <SelectItem value="executive">アプリ管理者のみ</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s-notes">メモ（任意）</Label>
            <Textarea id="s-notes" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {mode === 'edit' ? '保存する' : '追加する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RevealButton({ entryId }) {
  const [secret, setSecret] = useState(null)
  const [loading, setLoading] = useState(false)

  async function reveal() {
    if (secret) {
      setSecret(null)
      return
    }
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('account-secret', { body: { action: 'reveal', entry_id: entryId } })
    setLoading(false)
    if (error || data?.error) {
      toast.error(data?.error || '表示に失敗しました')
      return
    }
    setSecret(data.secret)
  }

  function copy() {
    navigator.clipboard.writeText(secret)
    toast.success('コピーしました')
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={reveal} disabled={loading}>
        {secret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {secret ? '隠す' : 'パスワードを表示'}
      </Button>
      {secret && (
        <>
          <code className="rounded-lg bg-muted px-2 py-1 text-xs">{secret}</code>
          <button onClick={copy} className="text-muted-foreground transition-colors hover:text-primary" aria-label="コピー">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  )
}

export default function AccountDirectory() {
  const { isExecutive } = useOutletContext()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const { data: entries, isLoading } = useQuery({
    queryKey: ['account_directory'],
    queryFn: async () => {
      const { data, error } = await supabase.from('account_directory').select('*').order('service_name')
      if (error) throw error
      return data
    },
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('account_directory').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account_directory'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <KeyRound className="h-6 w-6 text-primary" />
            アカウント管理
          </h1>
          <p className="text-sm text-muted-foreground">部で使うサービスの共有ログイン情報（担当者以上限定）</p>
        </div>
        {isExecutive && (
          <EntryFormDialog
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
      {!isLoading && (!entries || entries.length === 0) && (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">まだ登録されていません</Card>
      )}

      <div className="space-y-3">
        {entries?.map((e) => {
          const knownContacts = (entries ?? [])
            .filter((other) => other.id !== e.id && other.login_id)
            .map((other) => other.login_id.trim().toLowerCase())
          const contact = e.verification_contact?.trim().toLowerCase()
          const isPersonalContact = contact && !knownContacts.includes(contact)

          return (
            <Card key={e.id} className="p-4">
              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold">{e.service_name}</p>
                  {e.login_id && <p className="text-xs text-muted-foreground">{e.login_id}</p>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline">{MIN_TIER_LABEL[e.min_tier]}</Badge>
                  {isExecutive && (
                    <>
                      <button onClick={() => setEditing(e)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('このアカウント情報を削除しますか？')) remove.mutate(e.id)
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
              {e.notes && <p className="mb-1 text-xs text-muted-foreground">{e.notes}</p>}
              {e.verification_contact && (
                <p className="mb-1 text-xs text-muted-foreground">認証先: {e.verification_contact}</p>
              )}
              {isPersonalContact && (
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-amber-600">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  この認証先は部で管理されていない個人のアカウントの可能性があります
                </div>
              )}
              <RevealButton entryId={e.id} />
            </Card>
          )
        })}
      </div>

      {editing && <EntryFormDialog mode="edit" entry={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  )
}
