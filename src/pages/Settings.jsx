import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { Bot, Save } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function Settings() {
  const { profile } = useOutletContext()
  const isExecutive = profile?.club_roles?.tier === 'executive'
  const queryClient = useQueryClient()
  const [persona, setPersona] = useState('')

  const { data: setting, isLoading } = useQuery({
    queryKey: ['app_settings', 'ai_secretary_persona'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'ai_secretary_persona').single()
      if (error) throw error
      return data
    },
    enabled: isExecutive,
  })

  useEffect(() => {
    if (setting?.value) setPersona(setting.value)
  }, [setting])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('app_settings')
        .upsert({ key: 'ai_secretary_persona', value: persona, updated_by: profile.id, updated_at: new Date().toISOString() })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('AI秘書の設定を保存しました')
      queryClient.invalidateQueries({ queryKey: ['app_settings'] })
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  if (!isExecutive) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-8">
        <Card className="border-dashed p-8 text-center text-sm text-muted-foreground">この設定はアプリ管理者のみ閲覧できます</Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-2 flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-black tracking-tight">AI秘書の設定</h1>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        LINEのAI秘書bot（Claude Haiku 4.5）に与える性格・口調・前提知識です。ここを書き換えるだけで、コードを触らずに秘書の話し方を変えられます。次にbotに話しかけたときから反映されます。
      </p>

      <Card className="p-5">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="persona">キャラクター設定（システムプロンプト）</Label>
            <Textarea id="persona" rows={10} value={persona} onChange={(e) => setPersona(e.target.value)} className="text-sm" />
            <p className="text-xs text-muted-foreground">
              例: 話し方のトーン（タメ口／敬語）、絵文字を使うか、部の用語・伝統、答えてはいけないこと、なども自由に書き足せます。
            </p>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !persona.trim()}>
              <Save className="h-4 w-4" />
              保存する
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
