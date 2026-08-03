import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

// One-time, required prompt shown after login when profiles.name_confirmed is
// false: LINE display names are frequently nicknames/English names/emoji, not
// a member's real club-roster name, so we ask them to confirm or correct it.
// This applies to every existing member with an unconfirmed name, not just
// brand-new signups (see 0040_profile_name_confirmed.sql).
export default function NameConfirmDialog({ profile }) {
  const [correcting, setCorrecting] = useState(false)
  const [name, setName] = useState(profile?.full_name || '')
  const queryClient = useQueryClient()

  const confirm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('profiles').update({ name_confirmed: true }).eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', profile.id] }),
    onError: (err) => toast.error(`確認に失敗しました: ${err.message}`),
  })

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('名前を入力してください')
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: trimmed, name_confirmed: true })
        .eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', profile.id] }),
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  const pending = confirm.isPending || save.isPending

  return (
    <Dialog open>
      <DialogContent
        className="[&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>名前の確認</DialogTitle>
          <DialogDescription>
            {correcting
              ? '本名を入力してください。'
              : `LINEの表示名『${profile?.full_name}』は本名と同じですか？`}
          </DialogDescription>
        </DialogHeader>

        {correcting ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="full_name">本名</Label>
              <Input id="full_name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              保存する
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button className="flex-1" disabled={pending} onClick={() => confirm.mutate()}>
              はい、本名です
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={pending}
              onClick={() => {
                setName(profile?.full_name || '')
                setCorrecting(true)
              }}
            >
              いいえ、修正します
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
