import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  ChevronRight,
  FolderOpen,
  KeyRound,
  Megaphone,
  Settings as SettingsIcon,
  Tags,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'

const ITEMS = [
  { to: '/announcements', label: 'お知らせ', icon: Megaphone },
  { to: '/resources', label: '資料・リンク集', icon: FolderOpen },
  { to: '/members', label: '部員名簿', icon: Users },
  { to: '/settings', label: '設定', icon: SettingsIcon },
  { to: '/attributes', label: '属性管理', icon: Tags },
  { to: '/finance', label: '会計・会費', icon: Wallet },
  { to: '/emergency', label: '緊急連絡', icon: TriangleAlert, danger: true },
]

const OFFICER_ITEMS = [{ to: '/accounts', label: 'アカウント管理', icon: KeyRound }]

// Self-service "退部する" -- deliberately quiet/de-emphasized per the club
// owner's request (not a big card like the items above), but still a real
// confirm dialog (not a native confirm()) so the consequences are spelled
// out before the irreversible-feeling action. Calls the leave_club() RPC
// (0050_member_leave_and_restore.sql), which clears this profile's roles
// (blocked by the zero-executive lockout trigger if they're the sole
// remaining executive -- surfaced below via the raised error message) and
// sets profiles.left_at, hiding them from the roster. It's recoverable by
// an executive via Members.jsx's "復元する" button, which is why the dialog
// copy says "executive can undo" rather than "cannot be undone".
function LeaveClubSection() {
  const [open, setOpen] = useState(false)

  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_club')
      if (error) throw error
    },
    onSuccess: async () => {
      setOpen(false)
      await supabase.auth.signOut()
      // No manual redirect here -- the app's existing auth-state listener
      // takes over and sends signed-out users to the login screen.
    },
    onError: (err) => toast.error(`退部処理に失敗しました: ${err.message}`),
  })

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-8 block w-full text-center text-xs text-muted-foreground hover:text-destructive hover:underline"
      >
        退部する
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退部しますか？</DialogTitle>
            <DialogDescription>
              退部すると、部員名簿など アプリ内のあらゆる場所から見えなくなり、保持している役職はすべて解除されます。
              間違えて押してしまった場合も、アプリ管理者に連絡すれば復元してもらえます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={leave.isPending}>
                キャンセル
              </Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => leave.mutate()} disabled={leave.isPending}>
              退部する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function More() {
  const { profile, isOfficerPlus } = useOutletContext()
  const items = isOfficerPlus ? [...ITEMS, ...OFFICER_ITEMS] : ITEMS

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-black tracking-tight">その他</h1>
      {profile?.club_roles?.label_ja && (
        <p className="mb-6 text-sm text-muted-foreground">ログイン中: {profile.full_name}（{profile.club_roles.label_ja}）</p>
      )}

      <Card className="divide-y overflow-hidden p-0">
        {items.map(({ to, label, icon: Icon, danger }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50"
          >
            <Icon className={danger ? 'h-5 w-5 text-destructive' : 'h-5 w-5 text-primary'} />
            <span className={`flex-1 font-medium ${danger ? 'text-destructive' : ''}`}>{label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>

      <Link to="/sitemap" className="mt-4 block text-center text-xs text-muted-foreground hover:text-primary hover:underline">
        サイトマップ
      </Link>

      <LeaveClubSection />
    </div>
  )
}
