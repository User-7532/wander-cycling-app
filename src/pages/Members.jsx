import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Pencil, Phone, PhoneCall, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const YEAR_LABEL = { b1: '1年', b2: '2年', b3: '3年', b4: '4年', grad: '院生', ob: 'OB' }
const STATUS_LABEL = { active: '在籍', leave: '休部', ob: 'OB' }

function EditMemberDialog({ member, roles, open, onOpenChange }) {
  const [clubRoleId, setClubRoleId] = useState(member?.club_role_id)
  const [year, setYear] = useState(member?.year || '')
  const [status, setStatus] = useState(member?.status || 'active')
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ club_role_id: clubRoleId, year: year || null, status })
        .eq('id', member.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('更新しました')
      queryClient.invalidateQueries({ queryKey: ['members', 'full'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  if (!member) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member.full_name} の設定を編集</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>役職</Label>
            <Select value={String(clubRoleId)} onValueChange={(v) => setClubRoleId(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles?.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.label_ja}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>学年</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger>
                  <SelectValue placeholder="未設定" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(YEAR_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>在籍状況</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
            保存する
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function Members() {
  const { isOfficerPlus, isExecutive } = useOutletContext()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  const { data: roles } = useQuery({
    queryKey: ['club_roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('*').order('sort_order')
      if (error) throw error
      return data
    },
  })

  const { data: members, isLoading } = useQuery({
    queryKey: isOfficerPlus ? ['members', 'full'] : ['members', 'directory'],
    queryFn: async () => {
      if (isOfficerPlus) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone, emergency_contact, avatar_url, year, status, club_role_id, club_roles(label_ja, tier, sort_order)')
        if (error) throw error
        return data.sort((a, b) => (a.club_roles?.sort_order ?? 99) - (b.club_roles?.sort_order ?? 99))
      }
      const [{ data: directory, error: dirError }, { data: rolesList, error: roleError }] = await Promise.all([
        supabase.rpc('profiles_directory'),
        supabase.from('club_roles').select('id, label_ja, sort_order'),
      ])
      if (dirError) throw dirError
      if (roleError) throw roleError
      const roleById = Object.fromEntries(rolesList.map((r) => [r.id, r]))
      return directory
        .map((m) => ({ ...m, club_roles: roleById[m.club_role_id] }))
        .sort((a, b) => (a.club_roles?.sort_order ?? 99) - (b.club_roles?.sort_order ?? 99))
    },
  })

  const filtered = useMemo(() => {
    if (!members) return []
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => m.full_name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q))
  }, [members, search])

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
      <h1 className="mb-1 text-2xl font-black tracking-tight">{isOfficerPlus ? 'メンバー管理' : '部員名簿'}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {isOfficerPlus ? 'クラブメンバーの名簿・連絡先を管理します（役員のみ）' : '部員一覧'}
      </p>

      <div className="relative mb-6 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="氏名・メールで検索..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <Users className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">該当する部員がいません</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((m, i) => (
          <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.02 }}>
            <Card className="p-5">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={m.avatar_url} alt={m.full_name} />
                    <AvatarFallback>{m.full_name?.[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-bold">{m.full_name}</p>
                    {isOfficerPlus && m.email && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
                  </div>
                </div>
                {isExecutive && (
                  <button onClick={() => setEditing(m)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {m.club_roles?.label_ja && <Badge variant="secondary">{m.club_roles.label_ja}</Badge>}
                {m.year && YEAR_LABEL[m.year] && <Badge variant="outline">{YEAR_LABEL[m.year]}</Badge>}
                {m.status && m.status !== 'active' && <Badge variant="outline">{STATUS_LABEL[m.status]}</Badge>}
              </div>
              {isOfficerPlus && (m.phone || m.emergency_contact) && (
                <div className="space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  {m.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3" />
                      {m.phone}
                    </p>
                  )}
                  {m.emergency_contact && (
                    <p className="flex items-center gap-1.5">
                      <PhoneCall className="h-3 w-3" />
                      緊急連絡先: {m.emergency_contact}
                    </p>
                  )}
                </div>
              )}
            </Card>
          </motion.div>
        ))}
      </div>

      <EditMemberDialog member={editing} roles={roles} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />
    </div>
  )
}
