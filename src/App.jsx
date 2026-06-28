import {useState, useEffect} from 'react'
import {supabase} from './supabase'
import AuthCallback from './AuthCallback'

function LoginPage({onLogin}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function handleLineLogin(){
    const lineAuthUrl= `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${import.meta.env.VITE_LINE_CHANNEL_ID}&redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}&state=wandercycling&scope=profile%20openid`
    window.location.href = lineAuthUrl
  }

  async function handleLogin(){
    setError('')
    const {error}=await supabase.auth.signInWithPassword({email, password})
    if(error){
      setError('メールアドレスかパスワードが違います。')
    } else {
      onLogin()
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f0f4f8' }}>
      <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', width: '320px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '24px' }}>🚴 WanderCycling</h2>

        <button
          onClick={handleLineLogin}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#06C755',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
            marginBottom: '20px'
          }}>
          LINEでログイン
        </button>

        <hr style={{ marginBottom: '20px' }} />

        <input
          placeholder="メールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: '100%', padding: '10px', marginBottom: '12px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }}
        />
        <input
          type="password"
          placeholder="パスワード"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', padding: '10px', marginBottom: '8px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }}
        />
        {error && <p style={{ color: 'red', fontSize: '14px', marginBottom: '12px' }}>{error}</p>}
        <button
          onClick={handleLogin}
          style={{ width: '100%', padding: '12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', cursor: 'pointer', marginTop: '8px' }}>
          ログイン
        </button>
      </div>
    </div>
  )
}

function Dashboard({ onLogout }) {
  const [schedules, setSchedules] = useState([])

  async function fetchSchedules() {
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .order('start_date', { ascending: true })

    if (error) {
      console.log(error)
    } else {
      setSchedules(data)
    }
  }

  useEffect(() => {
    fetchSchedules()
  }, [])

  return (
    <div style={{ padding: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1>WanderCycling</h1>
        <button
          onClick={onLogout}
          style={{ padding: '8px 16px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
          ログアウト
        </button>
      </div>

      <h2>📅 スケジュール</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
        {schedules.map((s) => (
          <div key={s.id} style={{
            padding: '16px',
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
          }}>
            <h3 style={{ margin: '0 0 8px 0' }}>{s.title}</h3>
            <p style={{ margin: '4px 0', color: '#555' }}>📍 {s.place}</p>
            <p style={{ margin: '4px 0', color: '#555' }}>🗓 {s.start_date}～{s.end_date}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function App() {
  const [page, setPage] = useState('login')

  useEffect(() => {
    // 既にログイン済みならダッシュボードへ
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setPage('dashboard')
    })
  }, [])

  if (window.location.pathname === '/auth/callback') {
    return <AuthCallback onLogin={() => {
      window.location.href = '/'
    }} />
  }

  return (
    <div>
      {page === 'login' && <LoginPage onLogin={() => setPage('dashboard')} />}
      {page === 'dashboard' && <Dashboard onLogout={() => setPage('login')} />}
    </div>
  )
}

export default App

    // const [email, SetEmail] = useState('')は、emailという変数、setEmailという更新関数の設定をしてる。
    // const handleLogin = async () => {}でもいいよ、functionかconstかは明示必須、しかしfunction宣言でないとhoistingできない
    // constは再代入禁止、letは再代入可能な変数。

    // const {A} = B は、オブジェクト分解代入。const A = B.A の縮約。
    // 逆に const A = {B} は、Bというクラスに属するインスタンスを構成員としてもつ構造体A={B:b_instance, ...}の宣言。なぜなら、{}の用法の一つに、「{A}はAをクラスとして含む構造体オブジェクトの生成（物）を表す」というのがあるから。

    // {email, password}は、{email: email, password: password}の縮約、同名だから省ける。Cでいうstruct{string email string password}みたいなもの。
    //100vh(viewport height)は、画面全部
    //J S(JavaScript)は、camelCase文化。cssは、camel-case文化。
    //paddingはdiv(箱)の中の内容物が内壁にくっつかないようにするためのパッド。
    //borderRadiusは角丸、0pxで四角。
    //HTMLでは直接的に画面を変化させて画面遷移するが、一方でReactでは「このstateにはこの画面が対応すべき」という条件下で、stateを直接変化させることで間接的に画面遷移する。
    //awaitが内側にある関数は必ずasyncと書かなくてはいけない。
    //async 上司(){ await 部下(...) }　上司は、仕事を分解して部下にやってもらうが、部下が仕事を終えるまでに時間がかかるので、待ってあげられる必要があり、待てるときその上司はasyncをつけられる。
    //import {useState} from 'react'の'react'が（./supabaseのようには相対パス表示ではなく）単にreactというだけで済むのは、npm install reactによって...project/node_modulesにライブラリが出来ていて、そこを参照してるから。./とかなかったら、ライブラリから探す、という約束。