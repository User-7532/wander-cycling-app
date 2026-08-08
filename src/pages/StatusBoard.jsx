import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { ChevronDown, MessageSquare, RefreshCw, Send, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const CATEGORY_LABEL = {
  status: '状況報告',
  task_done: 'タスク完了',
  facility_reservation: '施設予約',
  crowding_info: '混雑情報',
  other: 'その他',
}

function timeAgo(value) {
  const diffMs = Date.now() - new Date(value).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}時間前`
  return new Date(value).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

export default function StatusBoard() {
  const { user, profile } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('status')
  const [customCategory, setCustomCategory] = useState('')
  const [taskId, setTaskId] = useState('')
  // 掲示相手を絞る（任意）。デフォルトは全員（visibility='all'、これまでの挙動）。
  // どのメンバーでも投稿できるので is_executive() では絞らず、投稿者本人を
  // author_id として付ける（0069_status_post_targeting.sql）。
  const [targeted, setTargeted] = useState(false)
  const [recipientIds, setRecipientIds] = useState([])
  const [filterAttrId, setFilterAttrId] = useState('')
  const [filterValueId, setFilterValueId] = useState('')
  const [filterRoleId, setFilterRoleId] = useState('')
  const [standingAttributeValueIds, setStandingAttributeValueIds] = useState([])
  const [standingRoleIds, setStandingRoleIds] = useState([])

  const { data: members } = useQuery({
    queryKey: ['profiles', 'for-status-post-target'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return data
    },
    enabled: targeted,
  })

  const { data: attributes } = useQuery({
    queryKey: ['member_attributes', 'for-status-post-target'],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attributes').select('id, label').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: targeted,
  })

  const { data: attributeValues } = useQuery({
    queryKey: ['member_attribute_values', filterAttrId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').eq('attribute_id', filterAttrId).order('sort_order')
      if (error) throw error
      return data
    },
    enabled: !!filterAttrId,
  })

  const { data: clubRoles } = useQuery({
    queryKey: ['club_roles', 'for-status-post-target'],
    queryFn: async () => {
      const { data, error } = await supabase.from('club_roles').select('id, label_ja').order('sort_order')
      if (error) throw error
      return data
    },
    enabled: targeted,
  })

  // Label lookup for standing-target chips: can span attributes other than
  // the one currently selected in the filter dropdown above.
  const { data: standingAttributeValueLabels } = useQuery({
    queryKey: ['member_attribute_values', 'standing-labels', standingAttributeValueIds],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_attribute_values').select('id, value').in('id', standingAttributeValueIds)
      if (error) throw error
      return data
    },
    enabled: standingAttributeValueIds.length > 0,
  })

  // Distinct resolved recipient counts for the "特定N人" badge (0070) --
  // RLS on status_post_recipients already limits this to posts the caller
  // authored, is a target of, or is executive, so it's safe to always fetch.
  const { data: recipientCounts } = useQuery({
    queryKey: ['status_post_recipients', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('status_post_recipient_counts')
      if (error) throw error
      const counts = {}
      for (const r of data) counts[r.status_post_id] = r.recipient_count
      return counts
    },
  })

  async function applyAttributeFilter() {
    if (!filterValueId) return
    const { data, error } = await supabase.from('profile_attribute_values').select('profile_id').eq('attribute_value_id', filterValueId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(recipientIds)
    let added = 0
    let removed = 0
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id)
        removed++
      } else {
        next.add(id)
        added++
      }
    }
    setRecipientIds([...next])
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }
  async function applyRoleFilter() {
    if (!filterRoleId) return
    const { data, error } = await supabase.from('profile_roles').select('profile_id').eq('club_role_id', filterRoleId)
    if (error) {
      toast.error('メンバーの取得に失敗しました')
      return
    }
    const ids = data.map((r) => r.profile_id)
    const next = new Set(recipientIds)
    let added = 0
    let removed = 0
    for (const id of ids) {
      if (next.has(id)) {
        next.delete(id)
        removed++
      } else {
        next.add(id)
        added++
      }
    }
    setRecipientIds([...next])
    toast.success(`${added}人を選択、${removed}人を解除しました`)
  }
  function toggleStandingAttributeValue() {
    if (!filterValueId) return
    setStandingAttributeValueIds((prev) => (prev.includes(filterValueId) ? prev.filter((x) => x !== filterValueId) : [...prev, filterValueId]))
  }
  function toggleStandingRole() {
    if (!filterRoleId) return
    const roleId = Number(filterRoleId)
    setStandingRoleIds((prev) => (prev.includes(roleId) ? prev.filter((x) => x !== roleId) : [...prev, roleId]))
  }
  function toggleRecipient(id) {
    setRecipientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  function selectAllRecipients() {
    setRecipientIds((members ?? []).map((m) => m.id))
  }
  function deselectAllRecipients() {
    setRecipientIds([])
  }

  // Only fetched when needed, since picking "タスク完了" is what lets a post
  // also mark the task itself as done (誰でも誰のタスクでも完了にできる — this
  // board is where people report on each other's behalf too).
  const { data: openTasks } = useQuery({
    queryKey: ['tasks', 'open-for-status-board'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, assignee:profiles!tasks_assigned_to_fkey(full_name)')
        .neq('status', 'done')
        .order('due_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data
    },
    enabled: category === 'task_done',
  })

  const { data: posts, isLoading } = useQuery({
    queryKey: ['status_posts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('status_posts')
        .select('*, author:profiles!status_posts_author_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
  })

  // Live updates: any insert/update/delete on status_posts refreshes the list.
  useEffect(() => {
    const channel = supabase
      .channel('status_posts_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status_posts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['status_posts'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  const post = useMutation({
    mutationFn: async () => {
      const finalCategory = category === 'other' && customCategory.trim() ? customCategory.trim() : category
      const postId = crypto.randomUUID()
      const { error } = await supabase
        .from('status_posts')
        .insert({ id: postId, message, category: finalCategory, author_id: user.id, visibility: targeted ? 'targeted' : 'all' })
      if (error) throw error

      if (targeted) {
        const recipientRows = [
          ...recipientIds.map((profile_id) => ({ status_post_id: postId, author_id: user.id, profile_id })),
          ...standingAttributeValueIds.map((attribute_value_id) => ({ status_post_id: postId, author_id: user.id, attribute_value_id })),
          ...standingRoleIds.map((club_role_id) => ({ status_post_id: postId, author_id: user.id, club_role_id })),
        ]
        if (recipientRows.length > 0) {
          const { error: recError } = await supabase.from('status_post_recipients').insert(recipientRows)
          if (recError) throw recError
        }
      }

      if (category === 'task_done' && taskId) {
        const { error: taskError } = await supabase.rpc('complete_task_via_board', { target_task_id: taskId })
        if (taskError) throw taskError
      }
    },
    onSuccess: () => {
      setMessage('')
      setCustomCategory('')
      setTaskId('')
      setTargeted(false)
      setRecipientIds([])
      setFilterAttrId('')
      setFilterValueId('')
      setFilterRoleId('')
      setStandingAttributeValueIds([])
      setStandingRoleIds([])
      queryClient.invalidateQueries({ queryKey: ['status_posts'] })
      queryClient.invalidateQueries({ queryKey: ['status_post_recipients'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => toast.error(`投稿に失敗しました: ${err.message}`),
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('status_posts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status_posts'] }),
  })

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-black tracking-tight">掲示板</h1>
      <p className="mb-6 text-sm text-muted-foreground">今の状況をリアルタイムで共有しよう</p>

      <Card className="mb-6 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (message.trim()) post.mutate()
          }}
          className="space-y-3"
        >
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="例: 温泉Aは混んでます／キャンプ予約完了しました"
            rows={2}
            className="w-full resize-none rounded-xl border border-input bg-white/70 px-4 py-2.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v)
                setTaskId('')
              }}
            >
              <SelectTrigger className="w-40">
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
            {category === 'other' && (
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="属性名を入力"
                className="w-32"
              />
            )}
            <Button
              type="submit"
              size="sm"
              className="ml-auto"
              disabled={
                post.isPending ||
                !message.trim() ||
                (category === 'task_done' && !taskId) ||
                (targeted && recipientIds.length === 0 && standingAttributeValueIds.length === 0 && standingRoleIds.length === 0)
              }
            >
              <Send className="h-3.5 w-3.5" />
              投稿
            </Button>
          </div>
          {category === 'task_done' && (
            <div className="space-y-1.5 rounded-xl border border-input p-2">
              <Select value={taskId} onValueChange={setTaskId}>
                <SelectTrigger>
                  <SelectValue placeholder="完了にするタスクを選択" />
                </SelectTrigger>
                <SelectContent>
                  {openTasks?.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                      {t.assignee?.full_name ? `(${t.assignee.full_name})` : ''}
                    </SelectItem>
                  ))}
                  {openTasks?.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">未完了のタスクはありません</div>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">選択したタスクも、投稿と同時に「完了」になります(誰のタスクでも完了にできます)</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setTargeted((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${targeted ? 'rotate-180' : ''}`} />
            掲示相手を絞る（任意・デフォルトは全員）
          </button>

          {targeted && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5 rounded-xl border border-input p-2">
                <Label className="text-xs text-muted-foreground">属性で一括選択</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={filterAttrId}
                    onValueChange={(v) => {
                      setFilterAttrId(v)
                      setFilterValueId('')
                    }}
                  >
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="属性を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributes?.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={filterValueId} onValueChange={setFilterValueId} disabled={!filterAttrId}>
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="値を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {attributeValues?.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="secondary" disabled={!filterValueId} onClick={applyAttributeFilter}>
                    選択を切替
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  該当メンバーの選択状態を反転します（選択中なら解除、未選択なら選択）。
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant={standingAttributeValueIds.includes(filterValueId) ? 'default' : 'outline'}
                  disabled={!filterValueId}
                  onClick={toggleStandingAttributeValue}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  この属性値を対象に追加（自動更新）
                </Button>
              </div>

              <div className="space-y-1.5 rounded-xl border border-input p-2">
                <Label className="text-xs text-muted-foreground">役職で一括選択</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select value={filterRoleId} onValueChange={setFilterRoleId}>
                    <SelectTrigger className="sm:flex-1">
                      <SelectValue placeholder="役職を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {clubRoles?.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.label_ja}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="secondary" disabled={!filterRoleId} onClick={applyRoleFilter}>
                    選択を切替
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={standingRoleIds.includes(Number(filterRoleId)) ? 'default' : 'outline'}
                  disabled={!filterRoleId}
                  onClick={toggleStandingRole}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  この役職を対象に追加（自動更新）
                </Button>
              </div>

              {(standingAttributeValueIds.length > 0 || standingRoleIds.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {standingAttributeValueIds.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1 border border-primary/40 bg-primary/10 text-primary">
                      <RefreshCw className="h-3 w-3" />
                      {standingAttributeValueLabels?.find((v) => v.id === id)?.value ?? '...'}（自動更新）
                      <button
                        type="button"
                        onClick={() => setStandingAttributeValueIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 hover:text-destructive"
                        aria-label="削除"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                  {standingRoleIds.map((id) => (
                    <Badge key={id} variant="secondary" className="gap-1 border border-primary/40 bg-primary/10 text-primary">
                      <RefreshCw className="h-3 w-3" />
                      {clubRoles?.find((r) => r.id === id)?.label_ja ?? '...'}（自動更新）
                      <button
                        type="button"
                        onClick={() => setStandingRoleIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 hover:text-destructive"
                        aria-label="削除"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <Label>対象者（{recipientIds.length}人選択中）</Label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={selectAllRecipients}>
                      全員選択
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={deselectAllRecipients}>
                      全員解除
                    </Button>
                  </div>
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                  {members?.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={recipientIds.includes(m.id)} onChange={() => toggleRecipient(m.id)} />
                      {m.full_name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </form>
      </Card>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!isLoading && (!posts || posts.length === 0) && (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">投稿はまだありません</p>
        </Card>
      )}

      <div className="space-y-2.5">
        <AnimatePresence initial={false}>
          {posts?.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Card className="p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{p.author?.full_name || '部員'}</span>
                    <span>{timeAgo(p.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.visibility === 'targeted' && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Users className="h-3 w-3" />
                        特定{(p.author_id === user?.id || isExecutive) && recipientCounts?.[p.id] != null ? `${recipientCounts[p.id]}人` : ''}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      {CATEGORY_LABEL[p.category] || p.category}
                    </Badge>
                    {(p.author_id === user?.id || isExecutive) && (
                      <button onClick={() => remove.mutate(p.id)} className="text-muted-foreground transition-colors hover:text-destructive" aria-label="削除">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm">{p.message}</p>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
