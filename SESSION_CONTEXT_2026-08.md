# WanderCycling — セッション作業記録（2026年8月）

このファイルは、コンテキストウィンドウの圧縮に備えて作成した作業記録です。**このファイルだけを見ても作業を継続できる**ことを目標に、重要な情報を漏らさず書いています。

## プロジェクト基本情報

- **リポジトリ**: `C:\coding\wander-cycling-app`（このファイルがあるディレクトリ）
- **スタック**: React + Vite, Supabase (Postgres/Auth/Storage/Edge Functions/Realtime/Vault/pg_cron/pg_net), Tailwind + shadcn/ui, @tanstack/react-query, react-router-dom
- **Supabaseプロジェクトref**: `vygnnwtxokbizejxtdyc`
- **デプロイ**: Vercel（`wander-cycling-app.vercel.app`）、GitHubへのpushで自動デプロイされる想定
- **GitHub**: `User-7532/wander-cycling-app`、ブランチは`main`のみ
- **club_role_idはsmallint**（uuidではない）。member_attribute_valuesのidはuuid。
- **本番アカウントは実質1人**（開発者自身）+ テストデータ数名。DB操作は基本ロールバック付きトランザクションでテストしてから本番反映する運用。

### 開発フロー・運用ルール（重要、必ず踏襲すること）

1. **マイグレーションは`supabase/migrations/NNNN_name.sql`、連番を厳守**。最新は下記「マイグレーション一覧」参照。
2. **マイグレーション適用は`npx supabase db push --linked`**（対話式でYes入力が必要）。Dockerが動いていないという警告は無視してよい（想定内）。
3. **DB変更は必ずロールバック付きトランザクション(`begin; ... rollback;`)でテストしてから適用**。`npx supabase db query --linked --file <一時sqlファイル>`で実行。このCLIツールは**最後のSELECT文の結果しか表示しない**ので、複数の検証をしたい場合は複数回に分けて実行すること。
4. **RLSテストは`select set_config('request.jwt.claims', json_build_object('sub', '<profile_id>')::text, true); set local role authenticated; ...; reset role;`のパターンで、特定ユーザーになりすまして検証する**。
5. **Edge Functionのデプロイは`npx supabase functions deploy <name> --project-ref vygnnwtxokbizejxtdyc`**。新規関数は`supabase/config.toml`に`[functions.<name>]`セクションを追加すること（既存のnotify-task-updateなどを参考に）。
6. **`deno check supabase/functions/<name>/index.ts`で型チェック**。ただしこのプロジェクトには**既知の未修正の擬陽性エラーが多数ある**（`profile`/`conversation`のnullable narrowing、Supabase-jsのリレーション埋め込みが実際は単一オブジェクトなのに配列型に推論される問題、`catch(err){err.message}`のunknown型エラーなど）。新しいエラーカテゴリが増えていないかだけ確認すればよい。
7. **フロントエンドの検証は`npm run build`で確認**。ログイン必須のページはLINE OAuthが必要なため、この環境のブラウザツールでは実際の画面を直接確認できない（→ 下記「CSS検証の手法」参照、これで代替できる）。
8. **大きめの機能は必ず一旦要件を明確化してから実装**。ユーザーは「〜という認識でいい？」という確認質問を歓迎する（無駄に確認しすぎるのもNGだが、影響範囲が大きい・後戻りしにくい変更は確認する）。
9. **大きめの機械的な作業（複数ファイルにまたがるUI追加など）はバックグラウンドAgentに委譲**。委譲する際は「何がすでに存在するか」「正確なスキーマ・カラム名」「やってはいけないこと」を細かく指定し、完了後は必ずdiffを確認してからpushする。
10. **コミットメッセージは「なぜ」を書く。ユーザーに明示的に頼まれない限りpushしない**（このセッションでは頻繁に頼まれてpushしている）。
11. **不要になった検証用の一時HTML/CSSファイルは`public/`に作ってテストした後、必ず削除する**（`git status --short public/`で確認）。

### CSS検証の手法（ログイン不要で実際の見た目バグを数値で検証する方法）

このセッションで確立した、非常に有効な手法:

1. `npm run build`を実行し、`dist/assets/index-*.css`（実際にコンパイルされたTailwind CSS）を`public/`に一時コピーする。
2. 検証したい実際のJSXの構造・クラス名をそのまま再現した最小限のHTMLファイルを`public/`に作り、そのCSSをlinkする。
3. `mcp__Claude_Browser__preview_start`で dev server を起動（`.claude/launch.json`に`wander-cycling-app`という名前で設定済み、`npm run dev`、ポート5173）。
4. `mcp__Claude_Browser__navigate`で`http://localhost:5173/<test>.html`を開く。
5. `mcp__Claude_Browser__javascript_tool`で`getBoundingClientRect()`や`scrollWidth`を使い、要素の実際の幅・高さを数値で取得する。スクリーンショットは**この環境では「Browser paneが表示されていない」エラーで撮れないことが多い**ため、視覚確認ではなく数値測定に頼ること。
6. 修正前後で数値を比較し、問題が実際に再現・解消することを定量的に確認してからコードを直す。
7. **注意点**: `mcp__Claude_Browser__resize_window`は実際のビューポート幅を確実に変更してくれない（このセッションでは375pxを指定しても980px前後で固定されがちだった）。モバイル幅を再現したい場合は、`sm:`/`lg:`などのTailwindレスポンシブprefixがビューポート幅で判定されることを踏まえ、**レスポンシブprefixを使わず、素のクラス（例: `grid-cols-1`のみ）を直接指定したテストHTMLを作る**方が確実。
8. 検証が終わったら`public/`内のテスト用HTML/CSSファイルを必ず削除する。

---

## このセッションで実装した機能・修正一覧（時系列）

### 1. LINE秘書ボットの機能拡張（`supabase/functions/line-bot/index.ts`）

- **モデルをClaude Haiku 4.5からClaude Sonnet 5に昇格**(`ANTHROPIC_MODEL = 'claude-sonnet-5'`)。理由: しりとりの読み仮名判定・タスク曖昧判定などの精密な推論でHaikuが不安定だったため。この部の実際の利用規模なら料金差は誤差レベル、という判断。
- **知識ベース機能**: `club_knowledge`テーブル（0052）。`search_club_knowledge`/`save_club_knowledge`ツールで、承認フローなしに会話から自動で知識を保存・検索する（部の文化はレビューフローが根付かないため）。個人情報ではなく再利用可能な知識(場所・旅程・ノウハウ)限定。
- **Web検索・Webページ取得**: `web_search_20250305`/`web_fetch_20250910`（Haiku/Sonnet両方で使える基本版、動的フィルタリング版`_20260209`以降はSonnet 5でも使えるが未採用、将来の改善余地として残している）。
- **旅程の「物理層」プランニング指示**: システムプロンプトに、現地情報が事前に取れない場面（国境越えなど）にどう備えるかを具体的に考えるよう指示（オシュ→カシュガルの例で粒度を基準化）。
- **しりとり対応**: 複数回のバグ修正を経た。
  - 会話履歴を10件→30件に拡張(既出語を覚えていられるように)。
  - 「ん」判定が「含む」判定になっていたバグを修正（「りんご」を誤判定していた）→「最後の1文字だけを見る」ことを明示し、りんご/みかんの対比例で矯正。
  - 既出判定を読み(カタカナ)ベースにする指示、未知語は`web_search`で確認してから拒否する指示を追加。
  - **完璧の保証はしていない**（プロンプトレベルの緩和策であり、モデルの限界はある）。
- **タスク完了の曖昧さ解消**: `update_task_status`で複数タスクが該当する場合、勝手に選ばず`ambiguous:true`＋候補一覧を返し、本人に確認してから絞り込んで再実行するよう変更。
- **タスク完了の権限**: 他人のタスクは「完了」にすることだけ誰でもできる(掲示板と同じ扱い、`complete_task_via_board`RPC経由)。未着手/進行中への変更は本人か三役のみ。
- **`update_task`/`update_event`ツール追加**（三役限定）: 既存タスク・予定の編集。曖昧一致時は同じく確認を挟む。
- **属性/役職ベースの一括ターゲティング**: `resolveMemberQueries()`ヘルパー。クエリ文字列を順に「三役/役員」→`club_roles.label_ja`→`member_attribute_values.value`→氏名、の順で解決し、和集合を返す。`create_announcement`(target_queries, pinned)、`create_event`のinvitee_name_queries、新規`create_tasks_bulk`(sharedパラメータで協働タスク対応)、`set_announcement_pinned`で使用。
- **口座ディレクトリ等は今回触っていない**。

### 2. タスクの可視性システム（累積的に何度も改修、最終形が正）

**マイグレーション**: 0055 → 0057 → 0058(お知らせ側) → 0062 → 0063(バグ修正) → 0064 → 0065(バグ修正)

最終的な`tasks.visibility`は3値:
- `'all'` — 全員に公開
- `'restricted'`（デフォルト） — アプリ管理者・三役・担当者のみ
- `'private'` — アプリ管理者・担当者のみ（三役は自動的には含まれない。些細な個人タスクの通知が三役全員に飛ぶのを防ぐため追加）

`task_visible_to`テーブルで「その他、閲覧できる人」を追加できる（後述のdynamic targetsで属性/役職そのものも指定可能に拡張済み）。

RLSポリシー`"read visible tasks"`（0065時点の最終形）:
```sql
create policy "read visible tasks" on tasks for select using (
  visibility = 'all'
  or is_executive()
  or assigned_to = auth.uid()
  or exists (
    select 1 from task_visible_to tv
    where tv.task_id = tasks.id and member_matches_target(auth.uid(), tv.profile_id, tv.attribute_value_id, tv.club_role_id)
  )
  or (visibility = 'restricted' and is_yakuin())
);
```

**メンバー管理権限の拡大**（0057）: 従来「アプリ管理者(tier=executive)のみ」だったメンバー編集・削除・復元を「アプリ管理者 or 三役(is_yakuin)」に拡大。`profiles`/`profile_roles`のwrite RLS、`remove_member()`/`restore_member()`関数を修正。UI側は`Members.jsx`の`canManageMembers`変数(`isExecutive || isYakuin`)で統一済み。

**メンバー削除機能**（0056）: 既存の自己退部(`leave_club()`)と同じ仕組みを、管理者が他人に対して代理実行できる`remove_member(target_profile_id)`RPC。ハード削除ではなくソフト削除（`left_at`セット、ロール解除、`restore_member()`で取り消し可能）。

**お知らせのRLS抜け修正**（0058）: `announcements`テーブル自体には`visibility='targeted'`を強制するRLSがなく、`announcement_recipients`だけがガードされていた（=非対象者でもAPI直叩きで読めてしまう）バグを修正。`club_events`と同じパターン(officer+ or visibility='all' or recipient)に統一。

### 3. 協働タスク（複数人アサイン時の進行方式選択）

**マイグレーション**: 0059 → 0060(状態同期を「完了のみ」→「3状態すべて双方向」に拡張、かつ通知機能追加)

- `tasks.task_group_id`で複数タスク行を紐付け（多対多の担当者モデルではなく、1人1行のまま）。
- `propagate_shared_task_status()`トリガー（SECURITY DEFINER、`pg_trigger_depth() = 1`で再帰防止）: グループ内のどれか1行のstatusが変わったら、他の全行も同じstatusに揃える(未着手⇔進行中⇔完了、すべて双方向)。
- Tasks.jsx: 複数人選択時のみ「進行方式」セレクター(個別/協働)が出る。LINEボットの`create_tasks_bulk`にも`shared`パラメータで対応。

### 4. タスクステータス変更通知（0060）

`notify_task_status_change()`トリガー + 新規Edge Function`notify-task-status-change`。ステータスが変わるたびに、そのタスクの**可視者全員**(担当者・三役・アプリ管理者・task_visible_toの人、visibility='all'なら全員)にLINE通知が飛ぶ。協働タスクグループの場合は全行の可視者を合算して重複排除(1人1通に集約)。

**確認ダイアログ**: Tasks.jsx側で、ステータスボタン押下時に必ず確認ダイアログを挟む(「本当に{ラベル}にしますか？...LINEで通知が送信されます」)。誤操作による通知乱発を防ぐため。

### 5. 個人テーマ設定（0061、`src/lib/theme.js`が中核）

Settings.jsxに3セクション追加:
- **テーマ**: ライト/ダークモード切替(`profiles.theme_mode`)＋ボタン色カスタマイズ(`profiles.theme_accent_color`、hex)。CSS変数を`AppShell.jsx`で動的に:root に上書き適用。ダークパレットは新規デザイン(既存のティール系ブランドカラーに合わせた配色)。
- **背景**: 画像/単色の切り替え(`profiles.background_mode`)。単色は白・黒プリセット+任意カラーピッカー(`profiles.background_color`)。既存の画像アップロード機能はそのまま維持。
- **フォント**: M PLUS Rounded 1c等のGoogle Fontsから選択、またはカスタムフォントファイルをアップロード(`profiles.font_choice`/`custom_font_url`、新規ストレージバケット`profile-fonts`、`profile-backgrounds`と同じ非公開・本人フォルダ限定の権限パターン)。

すべて個人設定で他人には見えない(既存の背景画像設定の設計思想を踏襲)。

### 6. ファイルアップロードの日本語ファイル名バグ修正（`src/lib/storage.js`）

**原因**: Supabase Storageのオブジェクトキーは半角英数字+一部記号のみ許可(`\w`はASCIIのみ、日本語NG)。ファイル名をそのままキーに使っていたため、日本語ファイル名で"Invalid key"エラーが発生。

**修正**: `safeStorageFilename(originalName)`共通関数を作成。拡張子は保持、ベース名は不正文字を`_`に置換、先頭にタイムスタンプを付与してユニーク性確保。5箇所すべてに適用: Schedule.jsx(予定の添付ファイル)、Finance.jsx(領収書)、Settings.jsx(背景画像/フォント/ギャラリー画像×3)。**表示名としてファイル名を使っている箇所はなかった**ため、変換しても実害なし。

### 7. UIバグ修正（ダイアログ・レイアウト系）

- **ダイアログの外側タップで閉じる問題**: `src/components/ui/dialog.jsx`の`DialogContent`に`onPointerDownOutside`のデフォルトを`preventDefault`に変更。共通コンポーネント1箇所の修正でアプリ全体に効く。Escapeキー・×ボタンでは引き続き閉じられる。
- **タイトルが選択状態(select-all)で開くダイアログ問題**: 同じく`dialog.jsx`の`onOpenChange``onOpenAutoFocus`を上書きし、Radixのデフォルト全選択フォーカスの代わりにカーソルを文末に移動する挙動に変更(`collapseCursorOnOpenAutoFocus`)。
- **タイトルが日本語1文字ずつ縦に折り返されるバグ**（Schedule/Tasks/Announcements/Home、後にFinance/Members/StatusBoard/Attributes/AccountDirectory/Resources/Emergencyにも同じパターンを発見して修正）: バッジ群の隣にあるタイトルが、日本語テキストの「単語区切りなし」特性により最小コンテンツ幅=1文字になり、バッジ側がshrink-0で場所を譲らないため極端に狭く押し込まれていた。**正しい修正はタイトル側に`flex-1`/`min-w-0`を足すことではなく**（これは試したが効かないことを実測で確認済み — `min-width:0`+`flex-basis:0%`の組み合わせは、行の折り返し判定でタイトルの寄与をゼロにしてしまい、折り返しトリガー自体が起きなくなる）、**外側の行に`flex-wrap`を追加する**こと（バッジ側が収まらない時は行ごと折り返す）。
- **部員名簿カードの横長バグ**: 二段階の原因があった。
  1. `truncate`を使っている要素(メールアドレス、SNSリンクの値)の親に`min-w-0`が無かった(`truncate`の`white-space:nowrap`が最小幅=全文字幅にしてしまう典型的なバグ)→ Members.jsxの2箇所を修正。
  2. **これだけでは不十分だった**（ユーザーから「まだ直ってない、最初は収まるがすぐ伸びる」と指摘され再調査）。真因は、部員名簿のグリッドが`className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"`で**モバイル幅(sm:未満)でのベースの列数指定が無かった**こと。列数未指定のgridは内容物の幅に合わせて自動サイズになり、`minmax(0,1fr)`の保護が効かない。`grid-cols-1`を明示的に追加して解決(`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`)。同じ抜けがHome.jsxのダッシュボードグリッドにもあったので合わせて修正。「最初は収まるがすぐ伸びる」という症状は、PublicProfileSection内のSNSリンクが**各カードごとに非同期取得**されるため、初期表示の一瞬後にコンテンツが増えて症状が出る、というタイミングだった。

### 8. 動的な属性/役職ターゲティング（このセッション最大級の機能、0064・0065が中核）

**背景**: お知らせ・タスク・予定で「属性で絞り込んで個人を選ぶ」機能は、選んだ瞬間のプロフィールIDを固定保存するだけだった。後から同じ属性を持った人が入部/追加されても、過去に作られた項目の対象には自動的に含まれない、という問題があった。

**解決策**（ユーザー了承済みの設計）:
- `task_visible_to`/`announcement_recipients`/`event_invitees`/`event_rsvp_viewers`の4テーブルに`attribute_value_id`(uuid)・`club_role_id`(smallint)カラムを追加。各行は`profile_id`/`attribute_value_id`/`club_role_id`のうちどれか1つだけが非nullという制約(discriminated union、check constraint)。
- 主キーを`(parent_id, profile_id)`の複合キーから、新規`id uuid`サロゲートキーに変更。代わりに3種類のpartial unique index(`where profile_id is not null`等)で重複防止。
- `member_matches_target(p_profile_id, p_target_profile_id, p_target_attribute_value_id, p_target_club_role_id)` SQL関数で「このプロフィールがこのターゲット条件にマッチするか」を判定。RLSポリシー全て(tasks/announcements/club_events + 4テーブル自身のread policy)がこれを使う。
- `resolve_task_visible_to(p_task_id)`等4つのRPC(`returns setof uuid`)で、対象条件を実際のプロフィールID集合に展開。通知系Edge Function(`notify-task-status-change`/`broadcast-announcement`/`broadcast-event-update`)はこれ経由で送信先を解決するよう変更済み。
- **既存の「属性で絞り込んで個人を選ぶ」フリップ選択の仕組みは一切変更していない**(そのまま個人IDの行を作る)。今回追加したのは**並行する別の仕組み**(属性値/役職そのものを対象として保存する「スタンディングターゲット」)。UIでは各ピッカーに「この属性値/役職を対象に追加（自動更新）」ボタン+チップ表示を追加。
- フロントエンド対応済み: Tasks.jsx(task_visible_to)、Announcements.jsx(announcement_recipients)、Schedule.jsx(event_invitees・event_rsvp_viewersの両方)。

**ハマった実装上のバグ（重要、同じ轍を踏まないこと）**:
- 0064で各テーブルに`id`サロゲートキーを追加した際、RLSポリシー内の`exists(select 1 from task_visible_to tv where tv.task_id = id and ...)`という**無qualifyの`id`参照**が、`task_visible_to`が独自の`id`列を持った瞬間に**内側のテーブルの`id`にスコープが変わってしまう**(SQLのスコープ解決規則で近い方が優先される)というバグを踏んだ。`tv.task_id = id`が実質`tv.task_id = tv.id`になり、常にfalseになっていた。**教訓: サブクエリ内で外側テーブルの列を参照するときは、外側テーブルを常に明示的にエイリアスすること**(`tv.task_id = tasks.id`のように)。0065で修正。
- PostgRESTの`setof uuid`関数のRPC戻り値は**素の配列**(`["uuid1","uuid2"]`)であってオブジェクトの配列ではない。実際にcurlで確認済み。

### 9. 役職ベースの一括選択（動的ターゲティングより前に実装済み、web appのみ）

タスク一括作成・スケジュール招待者/RSVP閲覧者・お知らせ送信先の各ピッカーに、既存の「属性で絞り込む」と並んで「役職で絞り込む」ボタンを追加(Tasks.jsx/Schedule.jsx/Announcements.jsx)。これは**個人IDに解決してフリップ選択する**従来型で、後の「動的ターゲティング」(セクション8)とは別物(動的ターゲティングは"役職そのものを対象として保存"、こちらは"役職に基づいて個人を選ぶだけ")。

### 10. セキュリティレビュー(ユーザー依頼で実施、DBに直接クエリして検証)

- 全テーブルRLS有効・ポリシーあり(`line_identities`だけポリシー0件だが、直接アクセスさせない意図的な設計として正しい)。
- クライアント側にサービスロールキー等の露出なし、`dangerouslySetInnerHTML`等のXSS経路なし。
- `account_directory`(共有アカウント帳)はSupabase Vaultで暗号化、平文保存していない。
- 個人カレンダーフィードは暗号学的乱数トークン(`calendar_feed_token`, `gen_random_uuid()`)で保護。
- 唯一見つかった実際の穴が上記「お知らせのRLS抜け」(セクション2内、0058で修正済み)。

### 11. 背景画像・使い方ガイド等の小さな成果物

- **デフォルト背景画像**: ユーザー提供の葉っぱ写真を`public/default-background.jpg`として保存、個人設定で背景未設定の場合のフォールバックに設定(`AppShell.jsx`)。
- **使い方ガイド(PDF/Word)**: `docx`パッケージ(Node.js)でWord生成→Word COM経由でPDF変換、部員向けにアプリ・LINEボットの機能説明書として1回限り生成・送付済み(コードには残らない、リポジトリ外の成果物)。

### 12. その他の小さな修正

- お知らせ・タスク・スケジュールの編集ダイアログで、タイトル入力欄が開いた瞬間に全選択されている問題（→UIバグ修正の項参照、これも同じdialog.jsx修正でカバー済み）。

---

## 現在のマイグレーション一覧（最新 = 0065）

```
...(このセッション以前から存在。詳細は省略)
0052_club_knowledge.sql
0053_ai_secretary_messages_seq.sql
0054_complete_task_via_board.sql
0055_task_visibility.sql
0056_admin_remove_member.sql
0057_yakuin_manage_members.sql
0058_announcement_visibility_rls.sql
0059_shared_task_completion.sql
0060_task_status_sync_and_notify.sql
0061_personal_theme.sql
0062_task_private_visibility.sql
0063_fix_task_visible_to_recursion.sql
0064_dynamic_group_targets.sql
0065_fix_dynamic_target_id_shadowing.sql
```

**次にマイグレーションを追加する場合は`0066_`から始めること。** 追加前に必ず`ls supabase/migrations | tail -3`で最新番号を確認する(複数エージェントが並行作業すると番号が衝突することがあった→`supabase migration repair --status applied <version>`で対処してきたが、実スキーマが本当に適用されているかを`information_schema`等で直接確認してからのみ使うこと)。

## Edge Functions一覧（このセッションで新規作成・大幅改修したもの）

- `line-bot`（大幅改修、モデル・ツール群多数追加）
- `calendar-feed`（既存、このセッションでは未変更）
- `notify-task-status-change`（新規）
- `notify-task-update`（既存、未変更）
- `complete_task_via_board` — これはEdge FunctionではなくSQL RPC
- `broadcast-announcement`（改修: resolve_announcement_recipients RPC経由に変更）
- `broadcast-event-update`（改修: resolve_event_invitees RPC経由に変更）
- `notify-member-left`（既存、未変更）

## 未着手・今後の課題として言及されたもの

- 班分け・班長(奢り義務)・旅行参加履歴のトラッキング機能 — ユーザーから要望が出たが、まだ何も存在しない状態だと確認しただけで、設計・実装はしていない。ボットへの実データクエリツール(SQL経由で集計)として作るのが良いという方向性だけ話した。
- Web検索/フェッチの動的フィルタリング版(`web_search_20260209`等)への移行 — Sonnet 5昇格で使えるようになったが、コード実行サンドボックスの挙動が変わる(allowed_callers等)ため、今回は見送り、別タスクとして残っている。
- Vercelのサブドメイン変更 — ユーザーが手動で行う必要がある(このエージェントにはVercel CLIセッションがない)、完了確認は取れていない。

## 重要な用語・略語（このプロジェクト固有）

- **三役**（旧: 役員）: `club_roles.is_yakuin = true`の役職を持つこと。tier='executive'とは別概念（重なることが多いが完全一致ではない、「アプリ管理者（指名）」ロールがis_yakuin=falseの例外）。
- **アプリ管理者**: `tier = 'executive'`。3役職＋指名枠。
- **担当者**: タスクのassigned_to、または一般に`tier='officer'`を指すこともある(文脈依存)。
- **協働タスク**: 複数人アサインされた1つの仕事で、誰か1人が完了すれば全員完了扱いになるタスク（例: 花火購入係）。
- **代**: 入部年度から計算される世代番号(`cohort_year + 2 - 1966`、部創設1966年)。`generation`属性として自動計算される。
- **OB**: 卒業済み(`active_status`属性が'OB')。ボットの知識ベースは意図的にOB個人の情報を追跡しない設計。

## メモリファイルとの関係

`C:\Users\1106y\.claude\projects\C--coding\memory\MEMORY.md`にWanderCyclingプロジェクトの長期記憶がある(`project_wandercycling_rebuild.md`等)。このセッション記録はそれを置き換えるものではなく補完するもの。次回セッション開始時は両方参照するとよい。
