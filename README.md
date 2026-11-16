# intervals-icu-proxy

**Languages:** [日本語](README.md) | [English](README.en.md)

Muse での利用を主な用途として、Intervals.icu の読み取り専用 API を Cloudflare Workers 経由で提供する REST プロキシです。Strava の課金を渋っていて、Muse から Activity を参照できない場合に役立ちます。

Intervals.icu の API キーは Worker の Secret に保存し、Muse には Worker 用の Bearer トークンだけを渡します。Intervals.icu の API キーや Basic 認証情報を Muse に渡す必要はありません。

## Worker 名と URL

- Worker 名: `iicu-proxy` (公開設定の例です。同じ名前の Worker がある場合は変更してください)
- URL: Cloudflare アカウントの `workers.dev` サブドメインによって決まります
- Muse 用の認証: `Authorization: Bearer <PROXY_BEARER_TOKEN>`
- CORS: 無効
- 書き込み: なし。GET のみ

## エンドポイント

- `GET /health`
- `GET /api/athlete`
- `GET /api/activities?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/activities/:id`
- `GET /api/wellness?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/events?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`

`/health` は認証不要で、Worker が直接 `{"ok":true}` を返します。`/api/*` は上記の Bearer 認証を使います。`activities`、`wellness`、`events` の `oldest` と `newest` は必須で、ISO 形式の日付を1つずつ指定してください。`oldest` は `newest` 以下で、他のクエリパラメータは指定できません。条件に合わない場合は `400` になります。`/health`、`/api/athlete`、`/api/activities/:id` にクエリを付けると `404` になります。

## セットアップ

必要なもの:

- Node.js
- npm
- Cloudflare アカウント
- Wrangler の認証 (`npx wrangler login`)
- bash、curl、openssl (確認コマンド用)
- POSIX shell (npm scripts 用。macOS/Linux など)

依存関係をインストールします。

```bash
npm install
```

Wrangler にログインします。

```bash
npx wrangler login
```

Wrangler の設定ファイルを作成します。`wrangler.jsonc` は `.gitignore` に含まれます。

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

コピーした `wrangler.jsonc` の Worker 名を自分の環境に合わせて編集してください。Datadog を使う場合は Datadog 設定も編集してください。

ローカル開発用の環境変数ファイルを作成します。

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` のプレースホルダーをローカル値に置き換えてください。`.dev.vars` は Git 管理外です。

ローカル Worker を実行します。

```bash
npm run typecheck
npm run dev
```

`npm test` はポート `8787` を使います。`npm run dev` を停止してから実行するか、別のポートを指定してください。

```bash
TEST_PORT=8788 npm test
```

本番 Secret は自分のターミナルから設定してください。

Intervals.icu の API キーは、Intervals.icu の Settings -> Developer Settings で発行します。

`PROXY_BEARER_TOKEN` は自分の端末でランダム生成し、パスワードマネージャーなどの安全な保管庫に保存してください。macOS/Linux では次のコマンドで生成できます。

```bash
openssl rand -hex 32
```

生成した値を保管したら、次のコマンドを実行し、プロンプトに入力します。

```bash
npx wrangler secret put INTERVALS_API_KEY
npx wrangler secret put PROXY_BEARER_TOKEN
```

トークンの値を README、ソースコード、ログ、Git 履歴に保存しないでください。

`INTERVALS_ATHLETE_ID` は任意設定で、Intervals.icu の上流 URL に指定する Athlete ID です。`0` は API キーに紐づく本人を意味します。未設定の場合、Worker は自動的に `0` を使います。別の Athlete を読み取る場合は、API キーに権限があればその Athlete ID を設定してください。

```bash
npx wrangler secret put INTERVALS_ATHLETE_ID
```

Datadog telemetry を有効にする場合だけ、次も設定します。

```bash
npx wrangler secret put DD_API_KEY
```

`DD_API_KEY` がなければ、Datadog への外部送信は発生しません。

## Datadog

Datadog site は US1 固定です。`DD_ENV`、`DD_SERVICE`、`DD_METRIC_PREFIX` はデプロイ先ごとの設定です。公開されている `wrangler.jsonc.example` には `DD_ENV` と `DD_SERVICE` の一般的な例を入れています。`DD_METRIC_PREFIX` は未設定なら既定値を使うため、example には入れていません。コピーした `wrangler.jsonc` は自分の環境に合わせて編集してください。

`DD_METRIC_PREFIX` は任意設定で、Datadog に送信するメトリクス名の先頭に付ける名前空間です。未設定の場合は prefix なしで、メトリクス名は次のとおりです。

```text
intervals_icu_proxy.requests
intervals_icu_proxy.request_latency_ms
intervals_icu_proxy.upstream_latency_ms
intervals_icu_proxy.upstream_errors
intervals_icu_proxy.auth_failures
```

Datadog telemetry をテストする場合など、prefix を付けたいときだけ `DD_METRIC_PREFIX` を設定してください。例えば `test.` を設定すると `test.intervals_icu_proxy.requests`、`my_name_space.` を設定すると `my_name_space.intervals_icu_proxy.requests` になります。末尾のドットは省略できます。不正な prefix (空文字を含む) の場合は telemetry だけが無効になり、プロキシは動作します。

メトリクスの型:

- `<prefix>intervals_icu_proxy.requests`: count
- `<prefix>intervals_icu_proxy.request_latency_ms`: gauge
- `<prefix>intervals_icu_proxy.upstream_latency_ms`: gauge (上流リクエスト時)
- `<prefix>intervals_icu_proxy.upstream_errors`: count (上流エラー時)
- `<prefix>intervals_icu_proxy.auth_failures`: count (認証失敗時)

Version タグには deploy 時の Git short commit hash を使います。Env、Service、Prefix を変更する場合は `wrangler.jsonc` の `vars` を自分の環境に合わせて編集してください。

Telemetry のタグは endpoint template、status class、outcome、Env、Service、Version などの低カーディナリティな値に限定しています。ID、日付、クエリ、認証情報は含めません。Intervals.icu の API キー、Bearer トークン、Datadog API キー、Authorization ヘッダーはログやエラー応答に出しません。

## デプロイ

```bash
npm run typecheck
npm test
git status
git diff

# ソースコードを変更した場合だけ実行
git add src package.json package-lock.json
git commit -m "Update proxy"

npm run deploy
```

`npm run deploy` は HEAD の short hash を `DD_VERSION` として注入します。ソースコードを変更した場合は、deploy 前に commit してください。変更していない clone 直後なら追加の commit は不要です。Git の short hash を使うため、ZIP ダウンロードではなく Git clone から実行してください。

初回 deploy では、Wrangler から `workers.dev` サブドメインの登録を求められる場合があります。

デプロイ成功時、Wrangler の出力に実際の Worker URL が表示されます。Cloudflare ダッシュボードの Worker の Overview 画面でも `workers.dev` URL を確認できます。確認した URL を Muse に渡してください。

<details>
<summary>任意: 手動で確認したい場合</summary>

Worker URL を設定します。

```bash
export WORKER_URL="https://<worker-name>.<your-workers-subdomain>.workers.dev"
```

`/health` は認証なしで確認できます。

```bash
curl -fsS "$WORKER_URL/health"
```

Bearer なしの API リクエストは、Worker 側に `PROXY_BEARER_TOKEN` が設定済みなら `401` になります。

```bash
curl -i "$WORKER_URL/api/athlete"
```

Bearer トークンはシェル履歴に残さないよう、非表示入力します。

```bash
read -rs PROXY_BEARER_TOKEN
printf '\n'
export PROXY_BEARER_TOKEN
```

認証付きの読み取りを確認します。`<activity-id>` には activities のレスポンスに含まれる `id` を使います。

```bash
curl -fsS \
  -H "Authorization: Bearer ${PROXY_BEARER_TOKEN}" \
  "$WORKER_URL/api/athlete"

curl -fsS \
  -H "Authorization: Bearer ${PROXY_BEARER_TOKEN}" \
  "$WORKER_URL/api/activities?oldest=2026-01-01&newest=2026-01-31"

curl -fsS \
  -H "Authorization: Bearer ${PROXY_BEARER_TOKEN}" \
  "$WORKER_URL/api/activities/<activity-id>"

curl -fsS \
  -H "Authorization: Bearer ${PROXY_BEARER_TOKEN}" \
  "$WORKER_URL/api/wellness?oldest=2026-01-01&newest=2026-01-31"

curl -fsS \
  -H "Authorization: Bearer ${PROXY_BEARER_TOKEN}" \
  "$WORKER_URL/api/events?oldest=2026-01-01&newest=2026-01-31"
```

確認後はシェル変数を削除します。

```bash
unset PROXY_BEARER_TOKEN
```

エラーコードの目安:

- `401`: Bearer トークンがない、または誤っている
- `400`: 日付範囲などのリクエスト形式が不正
- `404`: 許可されていないパス
- `405`: GET 以外のメソッド
- `500 server_misconfigured`: Worker の Secret が不足
- `502`: Intervals.icu の上流接続または上流レスポンスのエラー

</details>

## Muse と組み合わせる

### Muse に渡す情報

- Worker URL (Wrangler の出力または Cloudflare ダッシュボードで確認した URL)
- Bearer トークンはチャットに貼らないでください。Muse が安全な入力フォームを提供する場合は、そこに `PROXY_BEARER_TOKEN` を入力します。提供されない場合は、トークンをチャットに入力せず接続を中止してください
- 上記の GET エンドポイント一覧

### セットアップ用プロンプト

Muse に以下をそのまま渡すと、接続の設定から確認まで進めてくれます。

```text
intervals-icu-proxy に接続してください。
仕様は https://github.com/kyoppe/intervals-icu-proxy の README に書いてあります。
最初に Worker URL を私に聞いてください。
Bearer トークンはチャットに貼りたくないので、安全な入力フォームを提供できる場合だけ、そのリンクを用意してください。提供できない場合はトークンを要求しないでください。
入力が終わったら、その接続を使って athlete、activities、wellness、events が読めるか確認してください。
```

### 接続の流れ

1. Muse が Worker の `/health` と、トークンなしのアクセスが `401` になることを確認します。
2. Muse が安全な入力フォームを提供できる場合はリンクを出します。そこに `PROXY_BEARER_TOKEN` を入力してください。提供されない場合はトークンをチャットに貼らないでください。
3. Muse が接続を登録し、athlete、activities、wellness、events の読み取りを検証します。

前提として、Worker 側に `INTERVALS_API_KEY` と `PROXY_BEARER_TOKEN` の Secret が設定済みであること、必要に応じて `INTERVALS_ATHLETE_ID` を設定していること、Bearer トークンの控えをパスワードマネージャーなどに保管していることを確認してください。
