import { Link, useOutletContext } from 'react-router-dom'
import { Megaphone, FolderOpen, Users, TriangleAlert, Settings, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/card'

const ITEMS = [
  { to: '/announcements', label: 'お知らせ', icon: Megaphone },
  { to: '/resources', label: '資料', icon: FolderOpen },
  { to: '/members', label: '部員名簿', icon: Users },
  { to: '/emergency', label: '緊急連絡', icon: TriangleAlert, danger: true },
]

const EXECUTIVE_ITEMS = [{ to: '/management', label: '管理', icon: Settings }]

export default function More() {
  const { profile } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const items = isExecutive ? [...ITEMS, ...EXECUTIVE_ITEMS] : ITEMS

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-black tracking-tight">もっと</h1>
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
    </div>
  )
}
