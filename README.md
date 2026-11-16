# intervals-icu-proxy

A read-only Cloudflare Worker REST proxy for the Intervals.icu API.

The Worker keeps the Intervals.icu API key server-side and translates a static
Bearer token from Muse into the Basic authentication format required by
Intervals.icu.

## Endpoints

The Worker accepts only these GET endpoints:

- `GET /health`
- `GET /api/athlete`
- `GET /api/activities?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/activities/:id`
- `GET /api/wellness?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/events?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`

`/health` is unauthenticated. Every `/api/*` endpoint requires:

```text
Authorization: Bearer <PROXY_BEARER_TOKEN>
```

All other paths return `404`. All methods other than `GET` return `405`.
CORS is not enabled.

## Worker name and URL

The Worker name is configured in `wrangler.jsonc`:

```jsonc
"name": "iicu-proxy"
```

The name becomes the first label of the `workers.dev` hostname. The complete
URL also includes the `workers.dev` subdomain configured for the Cloudflare
account:

```text
https://<worker-name>.<your-workers-subdomain>.workers.dev
```

When cloning this repository, change `name` to a unique Worker name before
deploying. Use only letters, numbers, and dashes, with a maximum length of 63
characters. The deploy command prints the actual URL.

## Requirements

- Node.js
- npm
- A Cloudflare account
- Wrangler authentication via `wrangler login`

## Local development

Install dependencies:

```bash
npm install
```

Create a local, untracked variables file:

```bash
cp .dev.vars.example .dev.vars
```

Replace the placeholders in `.dev.vars` with local values. Never commit
`.dev.vars` or copy its values into source files.

Run the typecheck and local Worker:

```bash
npm run typecheck
npm run dev
```

## Configure production Secrets

Do not put production Secret values in this repository. Set them from your own
terminal with Wrangler:

```bash
npx wrangler secret put INTERVALS_API_KEY
npx wrangler secret put INTERVALS_ATHLETE_ID
npx wrangler secret put PROXY_BEARER_TOKEN
```

`INTERVALS_ATHLETE_ID` is optional. If it is not set, the Worker uses `0`,
which identifies the owner of the API key.

Datadog telemetry is optional. Set the Datadog API key only when telemetry is
needed:

```bash
npx wrangler secret put DD_API_KEY
```

If `DD_API_KEY` is not set, the Worker makes no Datadog requests. The default
Datadog site is US1. The initial metric settings are configured as:

- Environment: `kyo`
- Service: `intervals-icu-proxy`
- Metric prefix: `test.kyouhei.`

The metric prefix can be changed in the `vars` section of `wrangler.jsonc`.
It is normalized to one trailing dot and is placed before the fixed
`intervals_icu_proxy.` namespace. For example, `test.kyouhei.` produces
`test.kyouhei.intervals_icu_proxy.requests`. If it is unset, the default is
`intervals_icu_proxy.requests`. An invalid prefix disables telemetry without
disabling the proxy.

When enabled, the Worker submits these metrics:

- `<prefix>intervals_icu_proxy.requests` (`count`)
- `<prefix>intervals_icu_proxy.request_latency_ms` (`gauge`)
- `<prefix>intervals_icu_proxy.upstream_latency_ms` (`gauge`, when an upstream request was made)
- `<prefix>intervals_icu_proxy.upstream_errors` (`count`, when an upstream error occurred)
- `<prefix>intervals_icu_proxy.auth_failures` (`count`, when authentication failed)

Telemetry tags are limited to endpoint templates, status classes, outcomes,
environment, service, and the Git version. Request IDs, activity IDs, dates,
query strings, and credentials are not included.

The Worker sends `API_KEY:<INTERVALS_API_KEY>` as HTTP Basic authentication to
Intervals.icu. The API key, Bearer token, Datadog API key, and Authorization
headers are not written to application logs or returned in error responses.

## Deploy

Authenticate Wrangler and run the checks:

```bash
npx wrangler login
npm run typecheck
```

The deploy script injects the Git short commit hash as the Datadog `version`
tag. Create a commit before deploying:

```bash
git status
git diff
git commit -m "Deploy iicu proxy"
npm run deploy
```

`npm run deploy` stops if there is no Git commit. The deploy command prints the
Worker URL. Keep that URL separate from Secret values.

## Verify with curl

Set the deployed URL and the Bearer token in your local shell only:

```bash
export WORKER_URL="https://<worker-name>.<your-workers-subdomain>.workers.dev"
export PROXY_BEARER_TOKEN="<your-local-copy-of-the-proxy-token>"
```

Check the unauthenticated health endpoint:

```bash
curl -fsS "$WORKER_URL/health"
```

Check that the API rejects a request without a Bearer token:

```bash
curl -i "$WORKER_URL/api/athlete"
```

Call the authenticated endpoints:

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

## Muse configuration

Muse needs the Worker URL as its base URL. The Intervals.icu API key and the
proxy Bearer token must stay in the Worker configuration and must not be
provided to Muse.
