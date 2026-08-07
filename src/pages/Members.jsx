import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router-dom'
import { AtSign, ChevronDown, MapPin, Pencil, Phone, PhoneCall, Search, Tags, Trash2, UserRound, Users } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// club_roles doesn't have a color column (unlike member_attributes), so
// role badges are colored by tier using this fixed palette -- mirrors the
// same TIER_COLOR mapping used in the role-management UI in Attributes.jsx.
const TIER_COLOR = { executive: '#ef4444', officer: '#6366f1', general: '#64748b', alumni: '#a855f7' }

function AttributeValueBadge({ value, color }) {
  return (
    <Badge variant="outline" className="border" style={{ backgroundColor: `${color}1a`, borderColor: `${color}55`, color }}>
      {value}
    </Badge>
  )
}

// One badge per role a member holds (a profile can hold several
// concurrently via profile_roles / 兼任), color-coded by club_roles.tier.
function RoleBadge({ role }) {
  const color = TIER_COLOR[role.tier] ?? TIER_COLOR.general
  return (
    <Badge variant="outline" className="border font-bold" style={{ backgroundColor: `${color}1a`, borderColor: `${color}55`, color }}>
      {role.label_ja}
    </Badge>
  )
}

// Multi-select role picker (checkbox-style toggle chips), the same visual
// pattern as AttributeToggleFields below, but backed by profile_roles
// instead of profile_attribute_values so a profile can hold multiple
// club_roles rows at once (兼任). Each toggle writes immediately (no
// separate save step), matching how attribute toggles already behave.
function RoleMultiSelectField({ memberId, allRoles, currentRoleIds }) {
  const queryClient = useQueryClient()

  const toggleRole = useMutation({
    mutationFn: async ({ roleId, isAssigned }) => {
      if (isAssigned) {
        const { error } = await supabase.from('profile_roles').delete().eq('profile_id', memberId).eq('club_role_id', roleId)
        if (error) throw error
        return
      }
      const { error } = await supabase.from('profile_roles').insert({ profile_id: memberId, club_role_id: roleId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile_roles_full'] })
      queryClient.invalidateQueries({ queryKey: ['members', 'full'] })
      queryClient.invalidateQueries({ queryKey: ['members', 'directory'] })
    },
    // A role removal that would leave the club with zero アプリ管理者 is
    // rejected by the zero-executive-lockout trigger on profile_roles --
    // surface that Japanese error via toast instead of swallowing it.
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  return (
    <div className="space-y-1.5">
      <Label>役職（複数選択可）</Label>
      <div className="flex flex-wrap gap-1.5">
        {(allRoles ?? []).length === 0 && <p className="text-xs text-muted-foreground">役職がまだありません</p>}
        {(allRoles ?? []).map((r) => {
          const isAssigned = currentRoleIds.has(r.id)
          const color = TIER_COLOR[r.tier] ?? TIER_COLOR.general
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => toggleRole.mutate({ roleId: r.id, isAssigned })}
              disabled={toggleRole.isPending}
              className="rounded-full border px-2.5 py-1 text-xs font-bold transition-all disabled:opacity-50"
              style={isAssigned ? { backgroundColor: color, borderColor: color, color: '#fff' } : { backgroundColor: `${color}0d`, borderColor: `${color}55`, color }}
            >
              {r.label_ja}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">複数選べます（タップで選択・解除）</p>
    </div>
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

function EditMemberDialog({ member, roles, currentRoleIds, manualAttributes, assignedValueIds, systemValues, currentUserId, open, onOpenChange }) {
  const [cohortYear, setCohortYear] = useState(member?.cohort_year ?? '')
  const queryClient = useQueryClient()

  const generationValue = systemValues.find((v) => v.attribute.key === 'generation')
  const otherSystemValues = systemValues.filter((v) => v.attribute.key !== 'generation')

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ cohort_year: cohortYear === '' ? null : Number(cohortYear) })
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
          {/* Display/edit order: 代 (generation) -> 役職 (role) -> other attributes (学年/現役-OB, manual). */}
          {generationValue && (
            <div className="space-y-1.5">
              <Label>{generationValue.attribute.label}</Label>
              <div>
                <AttributeValueBadge value={generationValue.value} color={generationValue.attribute.color} />
              </div>
            </div>
          )}

          <RoleMultiSelectField memberId={member.id} allRoles={roles} currentRoleIds={currentRoleIds} />

          <div className="space-y-1.5 border-t border-border/60 pt-3">
            <Label htmlFor="cohort-year">入部年度（学年・現役/OB は自動計算されます、任意）</Label>
            <Input id="cohort-year" type="number" placeholder="例: 2024" value={cohortYear} onChange={(e) => setCohortYear(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {otherSystemValues.length === 0 && <p className="text-xs text-muted-foreground">現在の自動計算値はまだありません</p>}
              {otherSystemValues.map((v) => (
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

function ProfileGalleryThumbnail({ image }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.storage.from('profile-gallery').createSignedUrl(image.path, 300)
      if (!cancelled && !error) setUrl(data.signedUrl)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [image.path])

  function openFullSize() {
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      type="button"
      onClick={openFullSize}
      disabled={!url}
      className="aspect-square overflow-hidden rounded-lg border border-border/60 bg-muted disabled:cursor-default"
      aria-label={image.caption || '画像を見る'}
    >
      {url && <img src={url} alt={image.caption || ''} className="h-full w-full object-cover" />}
    </button>
  )
}

// Voluntarily-public self-expression content (自己紹介・SNS・ギャラリー画像) --
// the opposite of the officer+-only contact card below: every signed-in
// member can see this for every other member, since it's the member who
// chose to publish it. profile_social_links/profile_gallery_images RLS is
// open-select for any authenticated user, so no isOfficerPlus gating here.
function PublicProfileSection({ member }) {
  const { data: links } = useQuery({
    queryKey: ['profile_social_links', member.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_social_links')
        .select('*')
        .eq('profile_id', member.id)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  const { data: images } = useQuery({
    queryKey: ['profile_gallery_images', member.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_gallery_images')
        .select('*')
        .eq('profile_id', member.id)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return data
    },
  })

  const hasBio = !!member.bio
  const hasLinks = links && links.length > 0
  const hasImages = images && images.length > 0

  if (!hasBio && !hasLinks && !hasImages) return null

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-muted/40 p-3 text-xs">
      <p className="flex items-center gap-1 font-bold text-muted-foreground">
        <UserRound className="h-3 w-3" />
        本人が公開しているプロフィール
      </p>
      {hasBio && <p className="whitespace-pre-wrap text-foreground/90">{member.bio}</p>}
      {hasLinks && (
        <div className="space-y-0.5">
          {links.map((link) => (
            <p key={link.id} className="flex items-center gap-1 text-foreground/90">
              <AtSign className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-medium">{link.platform}:</span>
              <span className="min-w-0 flex-1 truncate">{link.value}</span>
            </p>
          ))}
        </div>
      )}
      {hasImages && (
        <div className="grid grid-cols-4 gap-1.5 pt-1">
          {images.map((image) => (
            <ProfileGalleryThumbnail key={image.id} image={image} />
          ))}
        </div>
      )}
    </div>
  )
}

// Executive-only, deliberately minimal list of members who left via the
// self-service "退部する" button in More.jsx (leave_club() RPC, see
// 0050_member_leave_and_restore.sql). Collapsed by default since this is a
// rarely-needed recovery tool, not part of the normal roster flow -- a
// simple name + timestamp + restore button is enough, it doesn't need to
// match the full roster card design.
function DepartedMembersSection() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const { data: departed, isLoading } = useQuery({
    queryKey: ['members', 'departed'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name, left_at').not('left_at', 'is', null).order('left_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: open,
  })

  const restore = useMutation({
    mutationFn: async (targetProfileId) => {
      const { error } = await supabase.rpc('restore_member', { target_profile_id: targetProfileId })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('復元しました')
      queryClient.invalidateQueries({ queryKey: ['members', 'departed'] })
      queryClient.invalidateQueries({ queryKey: ['members', 'full'] })
      queryClient.invalidateQueries({ queryKey: ['members', 'directory'] })
    },
    onError: (err) => toast.error(`復元に失敗しました: ${err.message}`),
  })

  return (
    <div className="mt-8 border-t border-border/60 pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        退部したメンバー
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground">読み込み中...</p>}
          {!isLoading && (departed ?? []).length === 0 && <p className="text-xs text-muted-foreground">退部したメンバーはいません</p>}
          {(departed ?? []).map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{m.full_name}</p>
                <p className="text-xs text-muted-foreground">{new Date(m.left_at).toLocaleString('ja-JP')} に退部</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => restore.mutate(m.id)} disabled={restore.isPending}>
                復元する
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Executive-only. Same reversible shape as the self-service 退部する button
// in More.jsx (leave_club()) -- just callable against someone else, via
// remove_member() (0056_admin_remove_member.sql). Never shown for the
// viewer's own card; self-removal already has its own dedicated flow.
function RemoveMemberButton({ member }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('remove_member', { target_profile_id: member.id })
      if (error) throw error
    },
    onSuccess: () => {
      setOpen(false)
      toast.success('退部処理をしました')
      queryClient.invalidateQueries({ queryKey: ['members', 'full'] })
      queryClient.invalidateQueries({ queryKey: ['members', 'directory'] })
      queryClient.invalidateQueries({ queryKey: ['members', 'departed'] })
    },
    onError: (err) => toast.error(`退部処理に失敗しました: ${err.message}`),
  })

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-muted-foreground transition-colors hover:text-destructive" aria-label="削除">
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{member.full_name}さんを退部扱いにしますか？</DialogTitle>
            <DialogDescription>
              部員名簿など アプリ内のあらゆる場所から見えなくなり、保持している役職はすべて解除されます。
              間違えた場合は、メンバーページ下部の「退部したメンバー」から復元できます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={remove.isPending}>
                キャンセル
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              退部扱いにする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function Members() {
  const { isExecutive, user } = useOutletContext()
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

  // The full set of roles each profile currently holds (兼任-aware), for
  // rendering role badges on every card and driving the multi-select in the
  // executive edit dialog. Readable by any signed-in member (see RLS on
  // profile_roles in 0045), independent of officer/yakuin status.
  const { data: profileRoles } = useQuery({
    queryKey: ['profile_roles_full'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profile_roles').select('profile_id, club_role_id, club_roles(label_ja, tier, is_yakuin, sort_order)')
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

  const profileRolesByProfile = useMemo(() => {
    const m = {}
    ;(profileRoles ?? []).forEach((row) => {
      const roleInfo = {
        club_role_id: row.club_role_id,
        label_ja: row.club_roles?.label_ja,
        tier: row.club_roles?.tier,
        is_yakuin: row.club_roles?.is_yakuin,
        sort_order: row.club_roles?.sort_order,
      }
      ;(m[row.profile_id] ??= []).push(roleInfo)
    })
    Object.values(m).forEach((arr) => arr.sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99)))
    return m
  }, [profileRoles])

  // 三役 = holds ANY role with is_yakuin=true, not just the "primary"
  // (highest-tier) role synced onto profiles.club_role_id -- with 兼任 a
  // yakuin role can be held alongside a non-yakuin one.
  const isYakuin = (profileRolesByProfile[user?.id] ?? []).some((r) => r.is_yakuin)
  // Executives always need cohort_year/club_role_id/etc. to edit members;
  // 三役 additionally need contact fields. Plain officers (tier='officer',
  // not yakuin) no longer get the full profile fetch -- narrower than the
  // old isOfficerPlus gate.
  const canManageMembers = isExecutive || isYakuin

  const { data: members, isLoading } = useQuery({
    queryKey: canManageMembers ? ['members', 'full'] : ['members', 'directory'],
    queryFn: async () => {
      if (canManageMembers) {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'id, full_name, email, phone, address, emergency_contact, avatar_url, bio, cohort_year, club_role_id, club_roles!profiles_club_role_id_fkey(label_ja, tier, sort_order, is_yakuin)'
          )
          .is('left_at', null)
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

  // Default roster order: 現役 members first (grade_year ascending, 1年 ->
  // 卒業), then OB, then anyone with no computed status yet (e.g. cohort_year
  // not set) grouped with 現役 since they're presumably still active; within
  // each group, あいうえお (Japanese) name order.
  const GRADE_RANK = { '1年': 1, '2年': 2, '3年': 3, '4年': 4, '卒業': 5 }
  const STATUS_RANK = { '現役': 0, undefined: 1, 'OB': 2 }

  const memberSortKey = (profileId) => {
    const values = (assignmentsByProfile[profileId] ?? []).map((vid) => valuesById[vid]).filter(Boolean)
    const grade = values.find((v) => v.attribute.key === 'grade_year')?.value
    const status = values.find((v) => v.attribute.key === 'active_status')?.value
    return [STATUS_RANK[status] ?? 1, GRADE_RANK[grade] ?? 6]
  }

  const filtered = useMemo(() => {
    if (!members) return []
    const q = search.trim().toLowerCase()
    const base = q ? members.filter((m) => m.full_name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)) : members
    return [...base].sort((a, b) => {
      const [aStatus, aGrade] = memberSortKey(a.id)
      const [bStatus, bGrade] = memberSortKey(b.id)
      if (aStatus !== bStatus) return aStatus - bStatus
      if (aGrade !== bGrade) return aGrade - bGrade
      return (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ja')
    })
  }, [members, search, assignmentsByProfile, valuesById])

  const selfMember = members?.find((m) => m.id === user?.id)
  const selfAssignedValueIds = new Set(assignmentsByProfile[user?.id] ?? [])

  const editingAssignedValueIds = new Set(assignmentsByProfile[editing?.id] ?? [])
  const editingSystemValues = (assignmentsByProfile[editing?.id] ?? [])
    .map((vid) => valuesById[vid])
    .filter((v) => v && v.attribute.managed_by === 'system')
  const editingCurrentRoleIds = new Set((profileRolesByProfile[editing?.id] ?? []).map((r) => r.club_role_id))

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-black tracking-tight">{canManageMembers ? 'メンバー管理' : '部員名簿'}</h1>
          <p className="text-sm text-muted-foreground">{canManageMembers ? 'メンバーの名簿・連絡先を管理します（三役限定）' : '部員一覧'}</p>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((m, i) => {
          const isSelf = m.id === user?.id
          const memberRoles = profileRolesByProfile[m.id] ?? []
          const allMemberValues = (assignmentsByProfile[m.id] ?? []).map((vid) => valuesById[vid]).filter(Boolean)
          const generationValue = allMemberValues.find((v) => v.attribute.key === 'generation')
          const otherMemberValues = allMemberValues.filter((v) => v.attribute.key !== 'generation')
          const memberIsYakuin = memberRoles.some((r) => r.is_yakuin)
          const memberIsExecutive = memberRoles.some((r) => r.tier === 'executive')
          return (
            <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: Math.min(i, 8) * 0.02 }}>
              <Card className="p-5">
                <div className="mb-3 flex flex-wrap items-start justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar>
                      <AvatarImage src={m.avatar_url} alt={m.full_name} />
                      <AvatarFallback>{m.full_name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-bold">{m.full_name}</p>
                      {isYakuin && m.email && <p className="truncate text-xs text-muted-foreground">{m.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSelf && (
                      <button onClick={() => setSelfTagging(true)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="自分の属性を編集">
                        <Tags className="h-4 w-4" />
                      </button>
                    )}
                    {canManageMembers && (
                      <button onClick={() => setEditing(m)} className="text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canManageMembers && !isSelf && <RemoveMemberButton member={m} />}
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {/* Badge order: 代 (generation) -> 役職 (role, possibly plural) -> other attributes. */}
                  {generationValue && <AttributeValueBadge value={generationValue.value} color={generationValue.attribute.color} />}
                  {memberRoles.map((r) => (
                    <RoleBadge key={r.club_role_id} role={r} />
                  ))}
                  {memberIsYakuin && <Badge variant="outline">三役</Badge>}
                  {memberIsExecutive && <Badge variant="outline">アプリ管理者</Badge>}
                  {otherMemberValues.map((v) => (
                    <AttributeValueBadge key={v.id} value={v.value} color={v.attribute.color} />
                  ))}
                </div>
                {isYakuin && (m.phone || m.address || m.emergency_contact) && (
                  <div className="space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <p className="font-bold">連絡先（三役限定・非公開）</p>
                    {m.phone && (
                      <p className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3" />
                        {m.phone}
                      </p>
                    )}
                    {m.address && (
                      <p className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" />
                        {m.address}
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
                <PublicProfileSection member={m} />
              </Card>
            </motion.div>
          )
        })}
      </div>

      {canManageMembers && <DepartedMembersSection />}

      <EditMemberDialog
        member={editing}
        roles={roles}
        currentRoleIds={editingCurrentRoleIds}
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
