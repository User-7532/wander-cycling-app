import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
      const { error } = await supabase.from('status_posts').insert({ message, category: finalCategory, author_id: user.id })
      if (error) throw error
    },
    onSuccess: () => {
      setMessage('')
      setCustomCategory('')
      queryClient.invalidateQueries({ queryKey: ['status_posts'] })
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
            <Select value={category} onValueChange={setCategory}>
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
            <Button type="submit" size="sm" className="ml-auto" disabled={post.isPending || !message.trim()}>
              <Send className="h-3.5 w-3.5" />
              投稿
            </Button>
          </div>
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
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{p.author?.full_name || '部員'}</span>
                    <span>{timeAgo(p.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
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
