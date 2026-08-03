import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router-dom'
import { Filter, Pencil, Phone, PhoneCall, Search, Tags, Users, X } from 'lucide-react'
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

function AttributeValueBadge({ value, color }) {
  return (
    <Badge variant="outline" className="border" style={{ backgroundColor: `${color}1a`, borderColor: `${color}55`, color }}>
      {value}
    </Badge>
  )
}

// Toggleable value chips for manual attributes, shared by self-tagging and the
// executive per-member editor. Writes directly to profile_attribute_values;
// RLS (profile_id = auth.uid() OR is_executive(), manual attributes only)
// is the real gate -- this component just calls the same mutation either way.
function AttributeToggleFields({ memberId, manualAttributes, assignedValueIds, currentUserId }) {
  const queryClient = useQueryClient()

  const toggleValue = useMutation({
    mutationFn: async ({ attribute, value, isAssigned }) => {
      if (isAssigned) {
        const { error } = await supabase.from('profile_attribute_values').delete().eq('profile_id', memberId).eq('attribute_value_id', value.id)
        if (error) throw error
        return
      }
      if (attribute.cardinality === 'single') {
        const otherIds = (attribute.member_attribute_values ?? []).map((v) => v.id).filter((id) => id !== value.id)
        if (otherIds.length > 0) {
          const { error: delError } = await supabase.from('profile_attribute_values').delete().eq('profile_id', memberId).in('attribute_value_id', otherIds)
          if (delError) throw delError
        }
      }
      const { error } = await supabase.from('profile_attribute_values').insert({ profile_id: memberId, attribute_value_id: value.id, assigned_by: currentUserId })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile_attribute_values'] }),
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  if (manualAttributes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        属性タイプがまだありません。
        <Link to="/attributes" className="text-primary underline">
          属性管理
        </Link>
        から作成できます。
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {manualAttributes.map((attribute) => (
        <div key={attribute.id} className="space-y-1.5">
          <Label>
            {attribute.label}
            {attribute.required && <span className="ml-1 text-destructive">*</span>}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {(attribute.member_attribute_values ?? []).length === 0 && <p className="text-xs text-muted-foreground">値がありません</p>}
            {(attribute.member_attribute_values ?? []).map((v) => {
              const isAssigned = assignedValueIds.has(v.id)
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => toggleValue.mutate({ attribute, value: v, isAssigned })}
                  disabled={toggleValue.isPending}
                  className="rounded-full border px-2.5 py-1 text-xs font-bold transition-all disabled:opacity-50"
                  style={
                    isAssigned
                      ? { backgroundColor: attribute.color, borderColor: attribute.color, color: '#fff' }
                      : { backgroundColor: `${attribute.color}0d`, borderColor: `${attribute.color}55`, color: attribute.color }
                  }
                >
                  {v.value}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{attribute.cardinality === 'single' ? 'ひとつだけ選べます' : '複数選べます'}（タップで選択・解除）</p>
        </div>
      ))}
      <Link to="/attributes" className="inline-block text-xs text-primary hover:underline">
        + 新しい値を追加する
      </Link>
    </div>
  )
}

function SelfAttributesDialog({ member, manualAttributes, assignedValueIds, currentUserId, open, onOpenChange }) {
  if (!member) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>自分の属性を編集</DialogTitle>
        </DialogHeader>
        <AttributeToggleFields memberId={member.id} manualAttributes={manualAttributes} assignedValueIds={assignedValueIds} currentUserId={currentUserId} />
      </DialogContent>
    </Dialog>
  )
}

function EditMemberDialog({ member, roles, manualAttributes, assignedValueIds, systemValues, currentUserId, open, onOpenChange }) {
  const [clubRoleId, setClubRoleId] = useState(member?.club_role_id)
  const [year, setYear] = useState(member?.year || '')
  const [status, setStatus] = useState(member?.status || 'active')
  const [cohortYear, setCohortYear] = useState(member?.cohort_year ?? '')
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ club_role_id: clubRoleId, year: year || null, status, cohort_year: cohortYear === '' ? null : Number(cohortYear) })
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
        <div className="space-y-4">
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
              <Label>学年（旧項目）</Label>
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
              <Label>在籍状況（旧項目）</Label>
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

          <div className="space-y-1.5 border-t border-border/60 pt-3">
            <Label htmlFor="cohort-year">入部年度（学年・現役/OB は自動計算されます）</Label>
            <Input id="cohort-year" type="number" placeholder="例: 2024" value={cohortYear} onChange={(e) => setCohortYear(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {systemValues.length === 0 && <p className="text-xs text-muted-foreground">現在の自動計算値はまだありません</p>}
              {systemValues.map((v) => (
                <AttributeValueBadge key={v.id} value={v.value} color={v.attribute.color} />
              ))}
            </div>
          </div>

          <div className="border-t border-border/60 pt-3">
            <AttributeToggleFields memberId={member.id} manualAttributes={manualAttributes} assignedValueIds={assignedValueIds} currentUserId={currentUserId} />
          </div>

          <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
            保存する
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BulkRoleAssignPanel({ members, attributes, roles, assignmentsByProfile }) {
  const [bulkAttributeId, setBulkAttributeId] = useState('')
  const [bulkValueId, setBulkValueId] = useState('')
  const [filters, setFilters] = useState([])
  const [bulkRoleId, setBulkRoleId] = useState('')
  const queryClient = useQueryClient()

  const bulkAttribute = attributes.find((a) => a.id === bulkAttributeId)
  const bulkValueOptions = bulkAttribute?.member_attribute_values ?? []

  const matches = useMemo(() => {
    if (filters.length === 0) return []
    return members.filter((m) => filters.every((f) => (assignmentsByProfile[m.id] ?? []).includes(f.valueId)))
  }, [members, filters, assignmentsByProfile])

  function addFilter() {
    const attribute = attributes.find((a) => a.id === bulkAttributeId)
    const value = attribute?.member_attribute_values?.find((v) => v.id === bulkValueId)
    if (!attribute || !value) return
    setFilters((prev) => (prev.some((f) => f.valueId === value.id) ? prev : [...prev, { attributeId: attribute.id, valueId: value.id, label: `${attribute.label}: ${value.value}` }]))
    setBulkValueId('')
  }

  const applyRole = useMutation({
    mutationFn: async () => {
      const ids = matches.map((m) => m.id)
      const { error } = await supabase.from('profiles').update({ club_role_id: Number(bulkRoleId) }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`${matches.length}名の役職を更新しました`)
      queryClient.invalidateQueries({ queryKey: ['members', 'full'] })
      setFilters([])
      setBulkRoleId('')
    },
    onError: (err) => toast.error(`一括更新に失敗しました: ${err.message}`),
  })

  return (
    <Card className="mt-8 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-4.5 w-4.5 text-primary" />
        <h2 className="font-bold">属性で絞り込んで一括役職変更</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">選んだ属性値すべてに一致するメンバーを対象に、役職をまとめて変更します。</p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="w-40 space-y-1.5">
          <Label>属性</Label>
          <Select
            value={bulkAttributeId}
            onValueChange={(v) => {
              setBulkAttributeId(v)
              setBulkValueId('')
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="選択" />
            </SelectTrigger>
            <SelectContent>
              {attributes.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label>値</Label>
          <Select value={bulkValueId} onValueChange={setBulkValueId}>
            <SelectTrigger>
              <SelectValue placeholder="選択" />
            </SelectTrigger>
            <SelectContent>
              {bulkValueOptions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addFilter} disabled={!bulkAttributeId || !bulkValueId}>
          条件を追加
        </Button>
      </div>

      {filters.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <span key={f.valueId} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs font-bold">
              {f.label}
              <button type="button" onClick={() => setFilters((prev) => prev.filter((x) => x.valueId !== f.valueId))} aria-label="条件を削除">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="mb-2 text-sm">
        該当メンバー: <span className="font-bold">{matches.length}名</span>
        {matches.length > 0 && <span className="text-xs text-muted-foreground">（{matches.map((m) => m.full_name).join('、')}）</span>}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48 space-y-1.5">
          <Label>変更後の役職</Label>
          <Select value={bulkRoleId} onValueChange={setBulkRoleId}>
            <SelectTrigger>
              <SelectValue placeholder="選択" />
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
        <Button
          type="button"
          size="sm"
          disabled={matches.length === 0 || !bulkRoleId || applyRole.isPending}
          onClick={() => {
            const roleLabel = roles?.find((r) => String(r.id) === bulkRoleId)?.label_ja
            if (confirm(`${matches.length}名の役職を「${roleLabel}」に変更しますか？`)) applyRole.mutate()
          }}
        >
          一括適用する
        </Button>
      </div>
    </Card>
  )
}

export default function Members() {
  const { isOfficerPlus, isExecutive, user } = useOutletContext()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [selfTagging, setSelfTagging] = useState(false)

  const { data: roles } = useQuery({
    queryKey: ['club_roles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('*').order('sort_order')
      if (error) throw error
      return data
    },
  })

  const { data: attributes } = useQuery({
    queryKey: ['member_attributes_full'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_attributes')
        .select('*, member_attribute_values(*)')
        .order('sort_order')
        .order('sort_order', { referencedTable: 'member_attribute_values' })
      if (error) throw error
      return data
    },
  })

  const { data: assignments } = useQuery({
    queryKey: ['profile_attribute_values'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_attribute_values').select('profile_id, attribute_value_id')
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
          .select('id, full_name, email, phone, emergency_contact, avatar_url, year, status, cohort_year, club_role_id, club_roles(label_ja, tier, sort_order, is_yakuin)')
        if (error) throw error
        return data.sort((a, b) => (a.club_roles?.sort_order ?? 99) - (b.club_roles?.sort_order ?? 99))
      }
      const [{ data: directory, error: dirError }, { data: rolesList, error: roleError }] = await Promise.all([
        supabase.rpc('profiles_directory'),
        supabase.from('club_roles').select('id, label_ja, sort_order, is_yakuin, tier'),
      ])
      if (dirError) throw dirError
      if (roleError) throw roleError
      const roleById = Object.fromEntries(rolesList.map((r) => [r.id, r]))
      return directory
        .map((m) => ({ ...m, club_roles: roleById[m.club_role_id] }))
        .sort((a, b) => (a.club_roles?.sort_order ?? 99) - (b.club_roles?.sort_order ?? 99))
    },
  })

  const manualAttributes = useMemo(() => (attributes ?? []).filter((a) => a.managed_by === 'manual'), [attributes])

  const valuesById = useMemo(() => {
    const m = {}
    ;(attributes ?? []).forEach((a) => {
      ;(a.member_attribute_values ?? []).forEach((v) => {
        m[v.id] = { ...v, attribute: a }
      })
    })
    return m
  }, [attributes])

  const assignmentsByProfile = useMemo(() => {
    const m = {}
    ;(assignments ?? []).forEach((row) => {
      ;(m[row.profile_id] ??= []).push(row.attribute_value_id)
    })
    return m
  }, [assignments])

  const filtered = useMemo(() => {
    if (!members) return []
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) => m.full_name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q))
  }, [members, search])

  const selfMember = members?.find((m) => m.id === user?.id)
  const selfAssignedValueIds = new Set(assignmentsByProfile[user?.id] ?? [])

  const editingAssignedValueIds = new Set(assignmentsByProfile[editing?.id] ?? [])
  const editingSystemValues = (assignmentsByProfile[editing?.id] ?? [])
    .map((vid) => valuesById[vid])
    .filter((v) => v && v.attribute.managed_by === 'system')

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-black tracking-tight">{isOfficerPlus ? 'メンバー管理' : '部員名簿'}</h1>
          <p className="text-sm text-muted-foreground">{isOfficerPlus ? 'クラブメンバーの名簿・連絡先を管理します（担当者以上限定）' : '部員一覧'}</p>
        </div>
        <Link to="/attributes" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          <Tags className="h-4 w-4" />
          属性管理
        </Link>
      </div>

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
        {filtered.map((m, i) => {
          const isSelf = m.id === user?.id
          const memberValues = (assignmentsByProfile[m.id] ?? []).map((vid) => valuesById[vid]).filter(Boolean)
          return (
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
                  <div className="flex items-center gap-2">
                    {isSelf && (
                      <button onClick={() => setSelfTagging(true)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="自分の属性を編集">
                        <Tags className="h-4 w-4" />
                      </button>
                    )}
                    {isExecutive && (
                      <button onClick={() => setEditing(m)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {m.club_roles?.label_ja && <Badge variant="secondary">{m.club_roles.label_ja}</Badge>}
                  {m.club_roles?.is_yakuin && <Badge variant="outline">役員</Badge>}
                  {m.club_roles?.tier === 'executive' && <Badge variant="outline">アプリ管理者</Badge>}
                  {m.year && YEAR_LABEL[m.year] && <Badge variant="outline">{YEAR_LABEL[m.year]}</Badge>}
                  {m.status && m.status !== 'active' && <Badge variant="outline">{STATUS_LABEL[m.status]}</Badge>}
                  {memberValues.map((v) => (
                    <AttributeValueBadge key={v.id} value={v.value} color={v.attribute.color} />
                  ))}
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
          )
        })}
      </div>

      {isExecutive && members && attributes && (
        <BulkRoleAssignPanel members={members} attributes={attributes} roles={roles} assignmentsByProfile={assignmentsByProfile} />
      )}

      <EditMemberDialog
        member={editing}
        roles={roles}
        manualAttributes={manualAttributes}
        assignedValueIds={editingAssignedValueIds}
        systemValues={editingSystemValues}
        currentUserId={user?.id}
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />

      {selfMember && (
        <SelfAttributesDialog
          member={selfMember}
          manualAttributes={manualAttributes}
          assignedValueIds={selfAssignedValueIds}
          currentUserId={user?.id}
          open={selfTagging}
          onOpenChange={setSelfTagging}
        />
      )}
    </div>
  )
}
