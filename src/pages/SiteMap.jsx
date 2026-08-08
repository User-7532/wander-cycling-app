import { Link, useOutletContext } from 'react-router-dom'
import {
  Bike,
  Calendar,
  FolderOpen,
  KeyRound,
  ListTodo,
  Megaphone,
  MessageSquare,
  PiggyBank,
  Settings as SettingsIcon,
  Tags,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react'
import { Card } from '@/components/ui/card'

const SECTIONS = [
  {
    title: 'メイン機能',
    items: [
      { to: '/', label: 'ダッシュボード', icon: Bike, desc: '予定・タスク・お知らせのまとめ' },
      { to: '/schedule', label: 'スケジュール', icon: Calendar, desc: '予定の確認・参加登録' },
      { to: '/tasks', label: 'タスク', icon: ListTodo, desc: '担当タスクの管理' },
      { to: '/board', label: 'ライブボード', icon: MessageSquare, desc: 'リアルタイム状況共有' },
      { to: '/announcements', label: 'お知らせ', icon: Megaphone, desc: '部からの連絡事項' },
      { to: '/resources', label: '資料', icon: FolderOpen, desc: '引継ぎ資料・安全講習・旅行Tips・お役立ちリンク' },
      { to: '/members', label: 'メンバー', icon: Users, desc: '部員名簿' },
      { to: '/emergency', label: '緊急連絡', icon: TriangleAlert, desc: '緊急時の手順・連絡先' },
    ],
  },
  {
    title: '個人設定',
    items: [
      { to: '/settings', label: '設定', icon: SettingsIcon, desc: 'カレンダーリンク・背景画像（アプリ管理者はAI秘書の設定も）' },
      { to: '/attributes', label: '属性管理', icon: Tags, desc: '学年・参加した旅などのタグを追加・自分に設定' },
      { to: '/finance', label: '会計・会費', icon: Wallet, desc: '自分の会費状況・立替払いの申請（アプリ管理者は収支管理も）' },
      { to: '/expenses', label: 'マイ家計簿', icon: PiggyBank, desc: 'ワンダーサイクリングでの自分の支出を記録（自分専用）' },
    ],
  },
]

const OFFICER_SECTION = {
  title: '担当者以上限定',
  items: [{ to: '/accounts', label: 'アカウント管理', icon: KeyRound, desc: '部で使うサービスの共有ログイン情報' }],
}

export default function SiteMap() {
  const { isOfficerPlus } = useOutletContext()
  const sections = isOfficerPlus ? [...SECTIONS, OFFICER_SECTION] : SECTIONS

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-black tracking-tight">サイトマップ</h1>
      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-2 text-sm font-bold text-muted-foreground">{section.title}</p>
            <Card className="divide-y overflow-hidden p-0">
              {section.items.map(({ to, label, icon: Icon, desc }) => (
                <Link key={to} to={to} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50">
                  <Icon className="h-4.5 w-4.5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                </Link>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </div>
  )
}
