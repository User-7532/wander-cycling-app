import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const CURRENT_YEAR = new Date().getFullYear()

// One-time, required prompt shown after login when profiles.name_confirmed is
// false: LINE display names are frequently nicknames/English names/emoji, not
// a member's real club-roster name, so we ask them to confirm or correct it.
// This applies to every existing member with an unconfirmed name, not just
// brand-new signups (see 0040_profile_name_confirmed.sql).
//
// Also collects cohort_year (入学年次) as part of this same one-time flow --
// it's the source-of-truth field that drives the auto-computed grade_year
// (学年), generation (代), and active_status (現役/OB) attributes (see
// update-member-status-attributes and 0034/0046). name_confirmed is only
// flipped to true once cohort_year has also been captured (both are written
// in a single final update), since AppShell renders this dialog purely off
// `profile.name_confirmed === false` -- flipping it early on the name step
// alone would make the dialog disappear before we ever asked for
// cohort_year.
export default function NameConfirmDialog({ profile }) {
  // 'confirm' -> asks about the LINE display name.
  // 'correcting' -> lets them type their real name instead.
  // 'cohortYear' -> collects 入学年次, then does the one combined save.
  const [step, setStep] = useState('confirm')
  const [name, setName] = useState(profile?.full_name || '')
  const [cohortYear, setCohortYear] = useState('')
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('名前を入力してください')
      const year = Number(cohortYear)
      if (!cohortYear || !Number.isInteger(year)) throw new Error('入学年次を入力してください')

      const { error } = await supabase
        .from('profiles')
        .update({ full_name: trimmed, name_confirmed: true, cohort_year: year })
        .eq('id', profile.id)
      if (error) throw error

      // Recompute grade_year/generation/active_status for everyone right
      // now, rather than waiting for the next 00:30 JST cron run, so this
      // member's 現役 status reflects immediately. Fire-and-forget: this is
      // a UX nicety only -- the daily cron will correct it regardless, so a
      // failure here must never block onboarding.
      supabase.rpc('trigger_update_member_status_attributes').then(({ error: rpcError }) => {
        if (rpcError) console.error('immediate status recompute failed (cron will retry tonight):', rpcError)
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile', profile.id] }),
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  const pending = save.isPending

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
            {step === 'confirm' && `LINEの表示名『${profile?.full_name}』は本名と同じですか？`}
            {step === 'correcting' && '本名を入力してください。'}
            {step === 'cohortYear' && '最後に、入学年次を教えてください。'}
          </DialogDescription>
        </DialogHeader>

        {step === 'confirm' && (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button className="flex-1" disabled={pending} onClick={() => setStep('cohortYear')}>
              はい、本名です
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={pending}
              onClick={() => {
                setName(profile?.full_name || '')
                setStep('correcting')
              }}
            >
              いいえ、修正します
            </Button>
          </div>
        )}

        {step === 'correcting' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              setStep('cohortYear')
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="full_name">本名</Label>
              <Input id="full_name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              次へ
            </Button>
          </form>
        )}

        {step === 'cohortYear' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate()
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="cohort_year">入学年次（学年・代・現役/OB が自動で決まります）</Label>
              <Input
                id="cohort_year"
                type="number"
                required
                autoFocus
                min="1966"
                max={CURRENT_YEAR}
                placeholder={`例: ${CURRENT_YEAR}`}
                value={cohortYear}
                onChange={(e) => setCohortYear(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              保存する
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
