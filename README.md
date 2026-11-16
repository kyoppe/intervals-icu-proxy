# intervals-icu-proxy

**Languages:** [日本語](README.md) | [English](README.en.md)

## 日本語

Intervals.icu の読み取り専用 API を、Cloudflare Workers 経由で Muse から利用するための REST プロキシです。

Intervals.icu の API キーは Worker の Secret に保存し、Muse からは Worker 用の Bearer トークンで認証します。Intervals.icu の API キーや Basic 認証情報を Muse に渡す必要はありません。

### 現在の Worker

- Worker 名: `iicu-proxy`
- URL: Cloudflare アカウントの `workers.dev` サブドメインによって決まります
- Muse 用の認証: `Authorization: Bearer <PROXY_BEARER_TOKEN>`
- CORS: 無効
- 書き込み: なし。GET のみ

### エンドポイント

- `GET /health`
- `GET /api/athlete`
- `GET /api/activities?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/activities/:id`
- `GET /api/wellness?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/events?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`

`/health` は認証不要で、Worker が直接 `{"ok":true}` を返します。`/api/*` は Bearer 認証が必須です。`activities`、`wellness`、`events` の `oldest` と `newest` は必須です。

### セットアップ

必要なもの:

- Node.js
- npm
- Cloudflare アカウント
- Wrangler の認証 (`npx wrangler login`)

依存関係をインストールします。

```bash
npm install
```

本番 Secret は自分のターミナルから設定してください。

```bash
npx wrangler secret put INTERVALS_API_KEY
npx wrangler secret put INTERVALS_ATHLETE_ID
npx wrangler secret put PROXY_BEARER_TOKEN
```

`INTERVALS_ATHLETE_ID` を設定しない場合は `0` を使います。Datadog telemetry を有効にする場合だけ、次も設定します。

```bash
npx wrangler secret put DD_API_KEY
```

`DD_API_KEY` がなければ、Datadog への外部送信は発生しません。

### Datadog

公開設定は `wrangler.jsonc` の `vars` にあります。

- Env: `kyo`
- Service: `intervals-icu-proxy`
- 現在の prefix: `test.kyouhei.`
- Version: deploy 時の Git short commit hash

現在のメトリクス名は次の形式です。

```text
test.kyouhei.intervals_icu_proxy.requests
test.kyouhei.intervals_icu_proxy.request_latency_ms
test.kyouhei.intervals_icu_proxy.upstream_latency_ms
test.kyouhei.intervals_icu_proxy.upstream_errors
test.kyouhei.intervals_icu_proxy.auth_failures
```

数日間観測した後に `test.kyouhei.` を外す場合は、`wrangler.jsonc` から `DD_METRIC_PREFIX` を削除して commit・deploy します。既定値は `intervals_icu_proxy.` です。既存の `test.kyouhei.*` メトリクスは削除されません。

### デプロイ

```bash
npx wrangler login
npm run typecheck
npm test
git status
git diff
git commit
npm run deploy
```

`npm run deploy` は commit の short hash を `DD_VERSION` として注入します。clone した場合は、deploy 前に `wrangler.jsonc` の `name` を自分用の一意な Worker 名へ変更してください。

### Muse に渡す情報

Muse には次を設定します。

- Worker URL
- Bearer トークン(パスワードマネージャーなどの安全な保管庫から設定)
- 上記の GET エンドポイント一覧

Intervals.icu の API キーは Muse に渡しません。
