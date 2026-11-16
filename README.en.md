# intervals-icu-proxy

**Languages:** [日本語](README.md) | [English](README.en.md)

This project is a Cloudflare Workers REST proxy for the read-only Intervals.icu
API, primarily intended for use from Muse. It is handy when you are reluctant
to pay for Strava and Muse cannot look up your activity.

The Intervals.icu API key is stored as a Worker Secret. Muse only receives a
separate Bearer token for the Worker, not the Intervals.icu API key or Basic
authentication credentials.

## Endpoints

The Worker accepts only these GET endpoints:

- `GET /health`
- `GET /api/athlete`
- `GET /api/activities?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/activities/:id`
- `GET /api/wellness?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- `GET /api/events?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`

`/health` is unauthenticated. Every `/api/*` endpoint requires a Bearer token:

```text
Authorization: Bearer <PROXY_BEARER_TOKEN>
```

All other paths return `404`. All methods other than `GET` return `405`.
For `activities`, `wellness`, and `events`, `oldest` and `newest` must each
be provided once as ISO dates, with `oldest` no later than `newest`. No other
query parameters are accepted. Invalid ranges return `400`. Adding a query
to `/health`, `/api/athlete`, or `/api/activities/:id` returns `404`.

## Worker name and URL

- Worker name: `iicu-proxy` (public configuration example; change it if the name is already in use)
- URL: determined by the Cloudflare account's `workers.dev` subdomain
- Muse authentication: `Authorization: Bearer <PROXY_BEARER_TOKEN>`
- CORS: disabled
- Writes: none; GET only

## Requirements

- Node.js
- npm
- A Cloudflare account
- Wrangler authentication via `npx wrangler login`
- bash, curl, and openssl for the verification commands
- A POSIX shell such as macOS/Linux shells for the npm scripts

## Local development

Install dependencies:

```bash
npm install
```

Authenticate Wrangler:

```bash
npx wrangler login
```

Create the local Wrangler configuration. `wrangler.jsonc` is listed in
`.gitignore`.

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Edit the copied `wrangler.jsonc` for your Worker name. Edit the Datadog
settings only if you use Datadog.

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

`npm test` uses port `8787`. Stop `npm run dev` before running it, or choose a
different port:

```bash
TEST_PORT=8788 npm test
```

## Configure production Secrets

Do not put production Secret values in this repository. Set them from your own
terminal with Wrangler.

Create an Intervals.icu API key in Intervals.icu under Settings ->
Developer Settings.

Generate `PROXY_BEARER_TOKEN` on your own machine and store it in a password
manager or another secure vault. On macOS/Linux, generate one with:

```bash
openssl rand -hex 32
```

After storing the generated value, run these commands and enter the values
when Wrangler prompts:

```bash
npx wrangler secret put INTERVALS_API_KEY
npx wrangler secret put PROXY_BEARER_TOKEN
```

Do not store the token in the README, source code, logs, or Git history.

`INTERVALS_ATHLETE_ID` is the Athlete ID used in the upstream Intervals.icu
URL. `0` identifies the athlete associated with the API key. If it is not set,
the Worker uses `0`, so it reads the API key owner's data. Set a different
Athlete ID only when the API key is permitted to read that athlete.

Set it only when you need an explicit Athlete ID:

```bash
npx wrangler secret put INTERVALS_ATHLETE_ID
```

Datadog telemetry is optional. Set the Datadog API key only when telemetry is
needed:

```bash
npx wrangler secret put DD_API_KEY
```

If `DD_API_KEY` is not set, the Worker makes no Datadog requests. The
Datadog site is fixed to US1. The public example uses:

- Environment: `production`
- Service: `intervals-icu-proxy`

`DD_ENV`, `DD_SERVICE`, and `DD_METRIC_PREFIX` are deployment-specific
settings. The public `wrangler.jsonc.example` contains general examples for
`DD_ENV` and `DD_SERVICE`; `DD_METRIC_PREFIX` is omitted so the default is used.
Customize the copied `wrangler.jsonc` for your environment.

`DD_METRIC_PREFIX` is optional. It is the namespace placed at the start of
every metric name sent to Datadog. If it is unset, the metric names are:

```text
intervals_icu_proxy.requests
intervals_icu_proxy.request_latency_ms
intervals_icu_proxy.upstream_latency_ms
intervals_icu_proxy.upstream_errors
intervals_icu_proxy.auth_failures
```

Set `DD_METRIC_PREFIX` only when you want a namespace, for example when
testing Datadog telemetry. `test.` produces
`test.intervals_icu_proxy.requests`, and `my_name_space.` produces
`my_name_space.intervals_icu_proxy.requests`. The trailing dot is optional. An
invalid prefix (including an empty string) disables telemetry without disabling
the proxy.

When enabled, the Worker submits metrics with the following types:

- `<prefix>intervals_icu_proxy.requests` (`count`)
- `<prefix>intervals_icu_proxy.request_latency_ms` (`gauge`)
- `<prefix>intervals_icu_proxy.upstream_latency_ms` (`gauge`, when an upstream request was made)
- `<prefix>intervals_icu_proxy.upstream_errors` (`count`, when an upstream error occurred)
- `<prefix>intervals_icu_proxy.auth_failures` (`count`, when authentication failed)

The Git short commit hash at deploy time is used as the `version` tag. Edit
the `vars` section of `wrangler.jsonc` for your deployment's environment,
service, and metric prefix.

Telemetry tags are limited to endpoint templates, status classes, outcomes,
environment, service, and the Git version. Request IDs, activity IDs, dates,
query strings, and credentials are not included.

The Worker sends `API_KEY:<INTERVALS_API_KEY>` as HTTP Basic authentication to
Intervals.icu. The API key, Bearer token, Datadog API key, and Authorization
headers are not written to application logs or returned in error responses.

## Deploy

Run the checks:

```bash
npm run typecheck
npm test
```

The deploy script injects the Git short commit hash as the Datadog `version`
tag. Review the working tree:

```bash
git status
git diff

# Run these only if you changed source files:
git add src package.json package-lock.json
git commit -m "Update proxy"

npm run deploy
```

`npm run deploy` uses the HEAD short hash as the `DD_VERSION` value. An
additional commit is not needed after an unchanged clone. If you changed
source files, commit them before deploying. The script reads the Git short
hash, so use a Git clone rather than a ZIP download.

On the first deploy, Wrangler may ask you to register a `workers.dev`
subdomain. The deploy command prints the Worker URL. The Cloudflare dashboard
also shows the `workers.dev` URL on the Worker's Overview page. Give the
confirmed URL to Muse and keep it separate from Secret values.

<details>
<summary>Optional: manual verification</summary>

Set the deployed URL in your local shell:

```bash
export WORKER_URL="https://<worker-name>.<your-workers-subdomain>.workers.dev"
```

Check the unauthenticated health endpoint:

```bash
curl -fsS "$WORKER_URL/health"
```

Check that the API rejects a request without a Bearer token:

```bash
curl -i "$WORKER_URL/api/athlete"
```

Read the Bearer token without displaying it or putting it in the shell
command history:

```bash
read -rs PROXY_BEARER_TOKEN
printf '\n'
export PROXY_BEARER_TOKEN
```

Call the authenticated endpoints. Use an `id` from the activities response for
`<activity-id>`:

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

Remove the token from the shell after verification:

```bash
unset PROXY_BEARER_TOKEN
```

Error code guide:

- `401`: missing or incorrect Bearer token
- `400`: invalid date range or request format
- `404`: path is not allowed
- `405`: method is not GET
- `500 server_misconfigured`: a Worker Secret is missing
- `502`: the upstream Intervals.icu request or response failed

</details>

## Using it with Muse

### Information Muse needs

- Worker URL (from the Wrangler output or the Cloudflare dashboard)
- Do not paste the Bearer token into chat. If Muse provides a secure input form, enter `PROXY_BEARER_TOKEN` there. If it does not, do not enter the token and stop the connection setup.
- The GET endpoint list above

### Setup prompt

Give Muse the following prompt to have it configure and verify the connection:

```text
Connect to intervals-icu-proxy.
The specification is in the README: https://github.com/kyoppe/intervals-icu-proxy
Ask me for the Worker URL first.
I do not want to paste the Bearer token into chat. Provide a link to a secure input form if you can. If you cannot, do not ask for the token.
After I finish, use the connection to verify that athlete, activities, wellness, and events can be read.
```

### Connection flow

1. Muse verifies `/health` and confirms that a request without a token returns `401`.
2. If Muse provides a secure input form, it provides a link. Enter `PROXY_BEARER_TOKEN` there. If it does not, do not paste the token into chat.
3. Muse registers the connection and verifies reads for athlete, activities, wellness, and events.

Before starting, set the `INTERVALS_API_KEY` and `PROXY_BEARER_TOKEN` Secrets on the Worker. Set `INTERVALS_ATHLETE_ID` when needed, and keep a copy of the Bearer token in a password manager or another secure vault.
