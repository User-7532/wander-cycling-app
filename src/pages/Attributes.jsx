import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Lock, Pencil, Plus, Shield, Tags, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const PRESET_COLORS = ['#22c55e', '#6366f1', '#f97316', '#ec4899', '#0ea5e9', '#eab308', '#a855f7', '#ef4444', '#14b8a6', '#64748b']

// club_roles.tier drives access control app-wide (see is_executive() /
// is_officer_or_above() in the DB). Kept here alongside the role-management
// UI rather than inferred, since a fresh role needs an explicit tier.
const TIER_LABEL = { executive: 'アプリ管理者 (executive)', officer: '担当者 (officer)', general: '一般 (general)', alumni: 'OB (alumni)' }
const TIER_OPTIONS = ['executive', 'officer', 'general', 'alumni']
// club_roles doesn't have a color column (unlike member_attributes), so role
// badges elsewhere in the app are colored by tier using this fixed palette.
const TIER_COLOR = { executive: '#ef4444', officer: '#6366f1', general: '#64748b', alumni: '#a855f7' }

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function AttributeFormDialog({ mode, attribute, open, onOpenChange, userId }) {
  const [label, setLabel] = useState(attribute?.label ?? '')
  const [key, setKey] = useState(attribute?.key ?? '')
  const [keyTouched, setKeyTouched] = useState(mode === 'edit')
  const [color, setColor] = useState(attribute?.color ?? PRESET_COLORS[0])
  const [cardinality, setCardinality] = useState(attribute?.cardinality ?? 'single')
  const [required, setRequired] = useState(attribute?.required ?? false)
  const queryClient = useQueryClient()

  function handleLabelChange(v) {
    setLabel(v)
    if (!keyTouched) setKey(slugify(v))
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = { key: key.trim(), label: label.trim(), color, cardinality, required }
      if (mode === 'create') {
        const { error } = await supabase.from('member_attributes').insert({ ...payload, created_by: userId })
        if (error) throw error
      } else {
        const { error } = await supabase.from('member_attributes').update(payload).eq('id', attribute.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? '属性タイプを作成しました' : '更新しました')
      queryClient.invalidateQueries({ queryKey: ['member_attributes_full'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新しい属性タイプを作成' : '属性タイプを編集'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="attr-label">表示名</Label>
            <Input id="attr-label" required placeholder="例: 参加した旅" value={label} onChange={(e) => handleLabelChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-key">キー（英数字・アンダースコア、一意）</Label>
            <Input
              id="attr-key"
              required
              placeholder="例: trips"
              value={key}
              onChange={(e) => {
                setKeyTouched(true)
                setKey(e.target.value)
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>色</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${color === c ? 'scale-110 border-foreground' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>選択方式</Label>
              <div className="space-y-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="cardinality" checked={cardinality === 'single'} onChange={() => setCardinality('single')} />
                  単一選択
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="cardinality" checked={cardinality === 'multi'} onChange={() => setCardinality('multi')} />
                  複数選択
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>必須</Label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                必須項目にする
              </label>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={save.isPending}>
            {mode === 'create' ? '作成する' : '保存する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AttributeValuesList({ attribute, userId, isExecutive, isSystem }) {
  const queryClient = useQueryClient()
  const [newValue, setNewValue] = useState('')
  const [editingValue, setEditingValue] = useState(null)

  const addValue = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('member_attribute_values').insert({ attribute_id: attribute.id, value: newValue.trim(), created_by: userId })
      if (error) throw error
    },
    onSuccess: () => {
      setNewValue('')
      queryClient.invalidateQueries({ queryKey: ['member_attributes_full'] })
    },
    onError: (err) => toast.error(`追加に失敗しました: ${err.message}`),
  })

  const updateValue = useMutation({
    mutationFn: async ({ id, value }) => {
      const { error } = await supabase.from('member_attribute_values').update({ value }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setEditingValue(null)
      queryClient.invalidateQueries({ queryKey: ['member_attributes_full'] })
    },
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  const deleteValue = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('member_attribute_values').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member_attributes_full'] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  const values = attribute.member_attribute_values ?? []

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.length === 0 && <p className="text-xs text-muted-foreground">まだ値がありません</p>}
        {values.map((v) => {
          const canEdit = !isSystem && (isExecutive || v.created_by === userId)
          const isEditing = editingValue?.id === v.id
          if (isEditing) {
            return (
              <form
                key={v.id}
                onSubmit={(e) => {
                  e.preventDefault()
                  if (editingValue.value.trim()) updateValue.mutate({ id: v.id, value: editingValue.value.trim() })
                }}
                className="flex items-center gap-1"
              >
                <Input autoFocus className="h-7 w-32 px-2 text-xs" value={editingValue.value} onChange={(e) => setEditingValue({ id: v.id, value: e.target.value })} />
                <button type="submit" className="text-xs font-bold text-primary">
                  保存
                </button>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => setEditingValue(null)}>
                  取消
                </button>
              </form>
            )
          }
          return (
            <span
              key={v.id}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold"
              style={{ backgroundColor: `${attribute.color}1a`, borderColor: `${attribute.color}55`, color: attribute.color }}
            >
              {v.value}
              {canEdit && (
                <>
                  <button type="button" onClick={() => setEditingValue({ id: v.id, value: v.value })} aria-label="編集" className="opacity-60 transition-opacity hover:opacity-100">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`「${v.value}」を削除しますか？メンバーへの割り当ても削除されます`)) deleteValue.mutate(v.id)
                    }}
                    aria-label="削除"
                    className="opacity-60 transition-opacity hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </span>
          )
        })}
      </div>
      {!isSystem && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newValue.trim()) addValue.mutate()
          }}
          className="flex items-center gap-1.5"
        >
          <Input className="h-8 max-w-[220px] text-xs" placeholder="新しい値を追加" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={!newValue.trim() || addValue.isPending}>
            <Plus className="h-3.5 w-3.5" />
            追加
          </Button>
        </form>
      )}
    </div>
  )
}

function AttributeCard({ attribute, userId, isExecutive, onEdit }) {
  const queryClient = useQueryClient()
  const isSystem = attribute.managed_by === 'system'

  const deleteAttribute = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('member_attributes').delete().eq('id', attribute.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('属性タイプを削除しました')
      queryClient.invalidateQueries({ queryKey: ['member_attributes_full'] })
    },
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: attribute.color }} />
          <div>
            <p className="font-bold">{attribute.label}</p>
            <p className="text-xs text-muted-foreground">
              {attribute.key} ・ {attribute.cardinality === 'single' ? '単一選択' : '複数選択'}
              {attribute.required && ' ・必須'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSystem ? (
            <Badge variant="outline" className="flex items-center gap-1">
              <Lock className="h-3 w-3" />
              自動管理
            </Badge>
          ) : (
            isExecutive && (
              <>
                <button onClick={() => onEdit(attribute)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`「${attribute.label}」を削除しますか？この属性の値・メンバーへの割り当てもすべて削除されます`)) deleteAttribute.mutate()
                  }}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label="削除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )
          )}
        </div>
      </div>
      {isSystem && (
        <p className="mb-3 text-xs text-muted-foreground">
          このタイプは入部年度（profiles.cohort_year）から自動計算されるため、値の編集・割り当ての変更はできません。メンバー編集画面で入部年度を設定してください。
        </p>
      )}
      <AttributeValuesList attribute={attribute} userId={userId} isExecutive={isExecutive} isSystem={isSystem} />
    </Card>
  )
}

// club_roles is its own dedicated section (not forced into the generic
// member_attributes/member_attribute_values CRUD above) because a role
// needs tier + is_yakuin, which generic attribute values don't have.
function ClubRoleFormDialog({ mode, role, existingRoles, open, onOpenChange }) {
  const [label, setLabel] = useState(role?.label_ja ?? '')
  const [tier, setTier] = useState(role?.tier ?? 'officer')
  const [isYakuin, setIsYakuin] = useState(role?.is_yakuin ?? false)
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'create') {
        const code = slugify(label) || `role_${crypto.randomUUID().slice(0, 8)}`
        const nextSortOrder = (existingRoles ?? []).reduce((max, r) => Math.max(max, r.sort_order ?? 0), 0) + 1
        const { error } = await supabase
          .from('club_roles')
          .insert({ code, label_ja: label.trim(), tier, is_yakuin: isYakuin, sort_order: nextSortOrder })
        if (error) throw error
      } else {
        const { error } = await supabase.from('club_roles').update({ label_ja: label.trim(), tier, is_yakuin: isYakuin }).eq('id', role.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(mode === 'create' ? '役職を作成しました' : '更新しました')
      queryClient.invalidateQueries({ queryKey: ['club_roles_full'] })
      queryClient.invalidateQueries({ queryKey: ['club_roles'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新しい役職を作成' : '役職を編集'}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="role-label">役職名</Label>
            <Input id="role-label" required placeholder="例: 会計監査" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>権限レベル</Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIER_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isYakuin} onChange={(e) => setIsYakuin(e.target.checked)} />
            三役にする（幹事長・副幹事長・会計に相当する役職）
          </label>
          <Button type="submit" className="w-full" disabled={save.isPending || !label.trim()}>
            {mode === 'create' ? '作成する' : '保存する'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ClubRoleRow({ role, isExecutive, onEdit }) {
  const queryClient = useQueryClient()

  const deleteRole = useMutation({
    mutationFn: async () => {
      // profile_roles.club_role_id and profiles.club_role_id both reference
      // club_roles(id) with a plain (RESTRICT-like) FK, so attempting to
      // delete a role that's still assigned to anyone would otherwise
      // surface a raw Postgres FK-violation error. Check both first so we
      // can show a clear Japanese message instead.
      const [{ count: prCount, error: prError }, { count: profileCount, error: profileError }] = await Promise.all([
        supabase.from('profile_roles').select('profile_id', { count: 'exact', head: true }).eq('club_role_id', role.id),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('club_role_id', role.id),
      ])
      if (prError) throw prError
      if (profileError) throw profileError
      const inUse = Math.max(prCount ?? 0, profileCount ?? 0)
      if (inUse > 0) {
        throw new Error(`この役職は現在${inUse}人に割り当てられているため削除できません。先に全員の役職を解除してから削除してください。`)
      }
      const { error } = await supabase.from('club_roles').delete().eq('id', role.id)
      if (error) {
        // Fallback safety net for a race (someone assigned this role between
        // our check above and the delete): 23503 = foreign_key_violation.
        if (error.code === '23503') {
          throw new Error('この役職は現在メンバーに割り当てられているため削除できません。先に全員の役職を解除してから削除してください。')
        }
        throw error
      }
    },
    onSuccess: () => {
      toast.success('役職を削除しました')
      queryClient.invalidateQueries({ queryKey: ['club_roles_full'] })
      queryClient.invalidateQueries({ queryKey: ['club_roles'] })
    },
    onError: (err) => toast.error(err.message),
  })

  const color = TIER_COLOR[role.tier] ?? '#64748b'

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div>
          <p className="text-sm font-bold">{role.label_ja}</p>
          <p className="text-xs text-muted-foreground">
            {TIER_LABEL[role.tier] ?? role.tier}
            {role.is_yakuin && ' ・三役'}
          </p>
        </div>
      </div>
      {isExecutive && (
        <div className="flex items-center gap-2">
          <button onClick={() => onEdit(role)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (confirm(`「${role.label_ja}」を削除しますか？`)) deleteRole.mutate()
            }}
            className="text-muted-foreground transition-colors hover:text-destructive"
            aria-label="削除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function ClubRolesSection({ isExecutive }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editingRole, setEditingRole] = useState(null)

  const { data: clubRoles, isLoading } = useQuery({
    queryKey: ['club_roles_full'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('*').order('sort_order')
      if (error) throw error
      return data
    },
  })

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-lg font-black tracking-tight">
            <Shield className="h-5 w-5 text-primary" />
            役職管理
          </h2>
          <p className="text-sm text-muted-foreground">クラブの役職（幹事長・企画など）を管理します。増設や兼任（複数役職の同時保持）に対応しています。</p>
        </div>
        {isExecutive && (
          <Button onClick={() => setCreateOpen(true)} size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="新しい役職">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-24 w-full" />}

      <div className="space-y-2">
        {clubRoles?.map((r) => (
          <ClubRoleRow key={r.id} role={r} isExecutive={isExecutive} onEdit={setEditingRole} />
        ))}
      </div>

      {isExecutive && <ClubRoleFormDialog mode="create" existingRoles={clubRoles} open={createOpen} onOpenChange={setCreateOpen} />}
      {editingRole && (
        <ClubRoleFormDialog mode="edit" role={editingRole} existingRoles={clubRoles} open={!!editingRole} onOpenChange={(v) => !v && setEditingRole(null)} />
      )}
    </div>
  )
}

export default function Attributes() {
  const { user, isExecutive } = useOutletContext()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingAttribute, setEditingAttribute] = useState(null)

  const { data: attributes, isLoading } = useQuery({
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

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 md:px-8 md:py-8">
      <ClubRolesSection isExecutive={isExecutive} />

      <div className="mb-6 flex items-start justify-between gap-3 border-t border-border/60 pt-6">
        <div>
          <h1 className="mb-1 flex items-center gap-2 text-2xl font-black tracking-tight">
            <Tags className="h-6 w-6 text-primary" />
            属性管理
          </h1>
          <p className="text-sm text-muted-foreground">学年・参加した旅など、部員に付けるタグを管理します。値の追加は誰でもできます。</p>
        </div>
        {isExecutive && (
          <Button onClick={() => setCreateOpen(true)} size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="新しい属性タイプ">
            <Plus className="h-5 w-5" />
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {!isLoading && (!attributes || attributes.length === 0) && (
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">まだ属性タイプがありません</Card>
      )}

      <div className="space-y-4">
        {attributes?.map((a) => (
          <AttributeCard key={a.id} attribute={a} userId={user?.id} isExecutive={isExecutive} onEdit={setEditingAttribute} />
        ))}
      </div>

      {isExecutive && <AttributeFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} userId={user?.id} />}
      {editingAttribute && (
        <AttributeFormDialog mode="edit" attribute={editingAttribute} open={!!editingAttribute} onOpenChange={(v) => !v && setEditingAttribute(null)} userId={user?.id} />
      )}
    </div>
  )
}
