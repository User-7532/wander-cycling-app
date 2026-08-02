import { Link } from 'react-router-dom'
import { Bot, ChevronRight, KeyRound, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/card'

const ITEMS = [
  { to: '/finance', label: '会計・会費', icon: Wallet },
  { to: '/accounts', label: 'アカウント管理', icon: KeyRound },
  { to: '/settings', label: 'AI秘書の設定', icon: Bot },
]

export default function Management() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-1 text-2xl font-black tracking-tight">管理</h1>
      <p className="mb-6 text-sm text-muted-foreground">執行部向けの管理機能</p>

      <Card className="divide-y overflow-hidden p-0">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50">
            <Icon className="h-5 w-5 text-primary" />
            <span className="flex-1 font-medium">{label}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>
    </div>
  )
}
