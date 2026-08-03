import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'
import { AtSign, Bot, CalendarClock, Contact, Copy, Image, Images, Pencil, Plus, RotateCcw, Save, Trash2, Upload, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/supabase'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const CALENDAR_FEED_BASE = 'https://vygnnwtxokbizejxtdyc.supabase.co/functions/v1/calendar-feed'

function CopyField({ value }) {
  function copy() {
    navigator.clipboard.writeText(value)
    toast.success('コピーしました')
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-muted px-2 py-1.5 text-xs">{value}</code>
      <button onClick={copy} className="shrink-0 text-muted-foreground transition-colors hover:text-primary" aria-label="コピー">
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function CalendarFeedSection({ profile }) {
  const { data } = useQuery({
    queryKey: ['profiles', 'calendar_feed_token', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('calendar_feed_token').eq('id', profile.id).single()
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })

  const token = data?.calendar_feed_token
  const httpsUrl = token ? `${CALENDAR_FEED_BASE}?token=${token}` : ''
  const webcalUrl = token ? `webcal://${CALENDAR_FEED_BASE.replace(/^https?:\/\//, '')}?token=${token}` : ''

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-primary" />
        <h2 className="font-bold">自分のカレンダーリンク</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        このリンクをスマホのカレンダーアプリに登録すると、公開されている予定に加えて、自分だけの有志予定と自分のタスクの期限が自動で反映されます。他の人には教えないでください。
      </p>
      {!token ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>ワンタップで登録（iPhone・Googleカレンダー対応）</Label>
            <a href={webcalUrl} className="inline-block text-sm font-medium text-primary hover:underline">
              タップしてカレンダーに登録する
            </a>
          </div>
          <div className="space-y-1.5">
            <Label>URLをコピー</Label>
            <CopyField value={httpsUrl} />
          </div>
        </div>
      )}
    </Card>
  )
}

function BackgroundSection({ profile }) {
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadPreview() {
      if (!profile?.background_url) {
        setPreview(null)
        return
      }
      const { data, error } = await supabase.storage.from('profile-backgrounds').createSignedUrl(profile.background_url, 60)
      if (!cancelled && !error) setPreview(data.signedUrl)
    }
    loadPreview()
    return () => {
      cancelled = true
    }
  }, [profile?.background_url])

  const upload = useMutation({
    mutationFn: async (file) => {
      const path = `${profile.id}/${file.name}`
      const { error: uploadError } = await supabase.storage.from('profile-backgrounds').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { error } = await supabase.from('profiles').update({ background_url: path }).eq('id', profile.id)
      if (error) throw error
      return path
    },
    onSuccess: () => {
      toast.success('背景を設定しました')
      queryClient.invalidateQueries({ queryKey: ['profile', profile.id] })
    },
    onError: (err) => toast.error(`アップロードに失敗しました: ${err.message}`),
    onSettled: () => setBusy(false),
  })

  const reset = useMutation({
    mutationFn: async () => {
      const previousPath = profile.background_url
      const { error } = await supabase.from('profiles').update({ background_url: null }).eq('id', profile.id)
      if (error) throw error
      if (previousPath) await supabase.storage.from('profile-backgrounds').remove([previousPath])
    },
    onSuccess: () => {
      toast.success('デフォルトの背景に戻しました')
      queryClient.invalidateQueries({ queryKey: ['profile', profile.id] })
    },
    onError: (err) => toast.error(`リセットに失敗しました: ${err.message}`),
  })

  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    upload.mutate(file)
  }

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <Image className="h-5 w-5 text-primary" />
        <h2 className="font-bold">背景画像</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        自分だけの背景画像を設定できます。他のメンバーには表示されません。
      </p>

      {preview && (
        <div
          className="mb-4 h-32 w-full overflow-hidden rounded-xl border border-border/60 bg-cover bg-center"
          style={{ backgroundImage: `url(${preview})` }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="background-upload"
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-input px-3 py-2 text-sm font-medium hover:bg-muted/50"
        >
          <Upload className="h-4 w-4" />
          {busy ? 'アップロード中...' : preview ? '画像を変更する' : '画像をアップロード'}
        </label>
        <input id="background-upload" type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={busy} />

        {profile?.background_url && (
          <Button type="button" variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
            <RotateCcw className="h-4 w-4" />
            デフォルトに戻す
          </Button>
        )}
      </div>
    </Card>
  )
}

function ContactSection({ profile }) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState(profile?.email ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [address, setAddress] = useState(profile?.address ?? '')

  useEffect(() => {
    setEmail(profile?.email ?? '')
    setPhone(profile?.phone ?? '')
    setAddress(profile?.address ?? '')
  }, [profile?.email, profile?.phone, profile?.address])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ email: email.trim() || null, phone: phone.trim() || null, address: address.trim() || null })
        .eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('連絡先を保存しました')
      queryClient.invalidateQueries({ queryKey: ['profile', profile.id] })
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <Contact className="h-5 w-5 text-primary" />
        <h2 className="font-bold">連絡先（任意）</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        書きたい人だけで大丈夫です。空欄のままでも問題ありません。
      </p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">メールアドレス（任意）</Label>
          <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@mail.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-phone">電話番号（任意）</Label>
          <Input id="contact-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="090-1234-5678" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-address">住所（任意）</Label>
          <Input id="contact-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="住所" />
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4" />
          保存する
        </Button>
      </div>
    </Card>
  )
}

function BioSection({ profile }) {
  const queryClient = useQueryClient()
  const [bio, setBio] = useState(profile?.bio ?? '')

  useEffect(() => {
    setBio(profile?.bio ?? '')
  }, [profile?.bio])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('profiles').update({ bio: bio.trim() || null }).eq('id', profile.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('自己紹介を保存しました')
      queryClient.invalidateQueries({ queryKey: ['profile', profile.id] })
    },
    onError: (err) => toast.error(`保存に失敗しました: ${err.message}`),
  })

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <UserRound className="h-5 w-5 text-primary" />
        <h2 className="font-bold">自己紹介（任意）</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        書きたい人だけで大丈夫です。ここに書いた内容は他のメンバーに公開されます。
      </p>
      <div className="space-y-3">
        <Textarea rows={4} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="自己紹介を書く..." />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4" />
          保存する
        </Button>
      </div>
    </Card>
  )
}

function SocialLinkRow({ link }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [platform, setPlatform] = useState(link.platform)
  const [value, setValue] = useState(link.value)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('profile_social_links').update({ platform: platform.trim(), value: value.trim() }).eq('id', link.id)
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['profile_social_links', link.profile_id] })
    },
    onError: (err) => toast.error(`更新に失敗しました: ${err.message}`),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('profile_social_links').delete().eq('id', link.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile_social_links', link.profile_id] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
        <Input value={platform} onChange={(e) => setPlatform(e.target.value)} className="h-8 min-w-[6rem] flex-1" aria-label="名称" />
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-[6rem] flex-[2]" aria-label="ID・リンクなど" />
        <Button type="button" size="sm" onClick={() => save.mutate()} disabled={save.isPending || !platform.trim() || !value.trim()}>
          保存
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          キャンセル
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
      <span className="font-medium">{link.platform}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{link.value}</span>
      <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-muted-foreground transition-colors hover:text-primary" aria-label="編集">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
        className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
        aria-label="削除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function SocialLinksSection({ profile }) {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState('')
  const [value, setValue] = useState('')

  const { data: links, isLoading } = useQuery({
    queryKey: ['profile_social_links', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_social_links')
        .select('*')
        .eq('profile_id', profile.id)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('profile_social_links').insert({ profile_id: profile.id, platform: platform.trim(), value: value.trim() })
      if (error) throw error
    },
    onSuccess: () => {
      setPlatform('')
      setValue('')
      queryClient.invalidateQueries({ queryKey: ['profile_social_links', profile.id] })
    },
    onError: (err) => toast.error(`追加に失敗しました: ${err.message}`),
  })

  function handleAdd() {
    if (!platform.trim() || !value.trim()) return
    add.mutate()
  }

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <AtSign className="h-5 w-5 text-primary" />
        <h2 className="font-bold">SNS・ID（任意）</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        インスタ・Swarmなど、教えたいものだけ自由に追加できます。名称は自由に入力できます。他のメンバーに公開されます。
      </p>

      {!isLoading && links?.length > 0 && (
        <div className="mb-4 space-y-2">
          {links.map((link) => (
            <SocialLinkRow key={link.id} link={link} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[7rem] flex-1 space-y-1.5">
          <Label htmlFor="sns-platform">名称</Label>
          <Input id="sns-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="例: Instagram" />
        </div>
        <div className="min-w-[7rem] flex-[2] space-y-1.5">
          <Label htmlFor="sns-value">ID・リンクなど</Label>
          <Input id="sns-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder="例: @your_id" />
        </div>
        <Button type="button" onClick={handleAdd} disabled={add.isPending || !platform.trim() || !value.trim()}>
          <Plus className="h-4 w-4" />
          追加
        </Button>
      </div>
    </Card>
  )
}

function GalleryThumbnail({ image, onRemove, removing }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase.storage.from('profile-gallery').createSignedUrl(image.path, 60)
      if (!cancelled && !error) setUrl(data.signedUrl)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [image.path])

  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl border border-border/60 bg-muted">
      {url && <img src={url} alt={image.caption || ''} className="h-full w-full object-cover" />}
      <button
        type="button"
        onClick={() => onRemove(image)}
        disabled={removing}
        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
        aria-label="削除"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {image.caption && (
        <p className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{image.caption}</p>
      )}
    </div>
  )
}

function GallerySection({ profile }) {
  const queryClient = useQueryClient()
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: images, isLoading } = useQuery({
    queryKey: ['profile_gallery_images', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profile_gallery_images')
        .select('*')
        .eq('profile_id', profile.id)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })

  const upload = useMutation({
    mutationFn: async (file) => {
      const path = `${profile.id}/${Date.now()}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('profile-gallery').upload(path, file)
      if (uploadError) throw uploadError
      const { error } = await supabase.from('profile_gallery_images').insert({ profile_id: profile.id, path, caption: caption.trim() || null })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('画像を追加しました')
      setCaption('')
      queryClient.invalidateQueries({ queryKey: ['profile_gallery_images', profile.id] })
    },
    onError: (err) => toast.error(`アップロードに失敗しました: ${err.message}`),
    onSettled: () => setBusy(false),
  })

  const remove = useMutation({
    mutationFn: async (image) => {
      const { error } = await supabase.from('profile_gallery_images').delete().eq('id', image.id)
      if (error) throw error
      await supabase.storage.from('profile-gallery').remove([image.path])
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile_gallery_images', profile.id] }),
    onError: (err) => toast.error(`削除に失敗しました: ${err.message}`),
  })

  function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    upload.mutate(file)
  }

  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <Images className="h-5 w-5 text-primary" />
        <h2 className="font-bold">ギャラリー画像（任意）</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        他のアプリを追加してもらうためのQRコードや、お気に入りの写真など、自由に追加できます。他のメンバーに公開されます。
      </p>

      {!isLoading && images?.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((image) => (
            <GalleryThumbnail key={image.id} image={image} onRemove={(img) => remove.mutate(img)} removing={remove.isPending} />
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="space-y-1.5">
          <Label htmlFor="gallery-caption">キャプション（任意）</Label>
          <Input id="gallery-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="例: 追加用QRコード" />
        </div>
        <label
          htmlFor="gallery-upload"
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-input px-3 py-2 text-sm font-medium hover:bg-muted/50"
        >
          <Upload className="h-4 w-4" />
          {busy ? 'アップロード中...' : '画像を追加'}
        </label>
        <input id="gallery-upload" type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={busy} />
      </div>
    </Card>
  )
}

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
        <h1 className="mb-6 text-2xl font-black tracking-tight">設定</h1>
        <div className="mb-6">
          <CalendarFeedSection profile={profile} />
        </div>
        <div className="mb-6">
          <BackgroundSection profile={profile} />
        </div>
        <div className="mb-6">
          <ContactSection profile={profile} />
        </div>
        <div className="mb-6">
          <BioSection profile={profile} />
        </div>
        <div className="mb-6">
          <SocialLinksSection profile={profile} />
        </div>
        <GallerySection profile={profile} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="mb-6 text-2xl font-black tracking-tight">設定</h1>

      <div className="mb-6">
        <CalendarFeedSection profile={profile} />
      </div>

      <div className="mb-6">
        <BackgroundSection profile={profile} />
      </div>

      <div className="mb-6">
        <ContactSection profile={profile} />
      </div>

      <div className="mb-6">
        <BioSection profile={profile} />
      </div>

      <div className="mb-6">
        <SocialLinksSection profile={profile} />
      </div>

      <div className="mb-6">
        <GallerySection profile={profile} />
      </div>

      <div className="mb-2 flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h2 className="text-xl font-black tracking-tight">AI秘書の設定</h2>
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
