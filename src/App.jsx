import {useState} from 'react'
import {supabase} from './supabase'

function LoginPage({onLogin}) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')

    async function handleLogin(){
        setError('')
        const {error}=await supabase.auth.signInWithPassword({email, password})
        if(error){
            setError('メールアドレスかパスワードが違います。')
        } else {
            onLogin()
        }
    }

    return(
        <div style={{}}>
            <div style={{}}>
                <h2 style={{}}>Wander Cycling</h2>
                <input
                    style={{}}
                    placeholder="メールアドレス"
                    value={email}
                    onChange={(e)=>setEmail(e.target.value)}
                />
                <input
                    style={{}}
                    placeholder="パスワード"
                    value={password}
                    onChange={(e)=>setPassword(e.target.value)}
                />
                {error && <p style={{}}>{error}</p>}
                <button
                    style={{}}
                    onClick = {handleLogin}
                >
                    ログイン
                </button>
            </div>
        </div>
    )
}

function Dashboard({onLogout}) {
    return (
        <div style={{}}>
            <div style={{}}>
                <h1>Wander Cycling Dashboard</h1>
                <button
                    style={{}}
                    onClick={onLogout}
                >
                    ログアウト
                </button>
            </div>
            <p>ダッシュボードへようこそ。</p>
        </div>
    )
}

function App() {
    const [page, setPage] = useState('login')

    return (
        <div>
            {page === 'login' && <LoginPage onLogin={()=> setPage('dashboard')} />}
            {page === 'dashboard' && <Dashboard onLogout={()=>setPage('login')}/>}
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