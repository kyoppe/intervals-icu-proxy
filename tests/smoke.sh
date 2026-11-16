#!/usr/bin/env bash

set -euo pipefail

port="${TEST_PORT:-8787}"
log_file="$(mktemp)"
wrangler_pid=""
proxy_token="$(openssl rand -hex 16)"
api_key="$(openssl rand -hex 16)"

cleanup() {
  if [[ -n "$wrangler_pid" ]]; then
    kill "$wrangler_pid" 2>/dev/null || true
  fi
  rm -f "$log_file"
}

trap cleanup EXIT INT TERM

npx wrangler dev \
  --local \
  --port "$port" \
  --var "PROXY_BEARER_TOKEN:${proxy_token}" \
  --var "INTERVALS_API_KEY:${api_key}" \
  >"$log_file" 2>&1 &
wrangler_pid=$!

curl --retry 15 --retry-connrefused --retry-delay 1 \
  -fsS -o /dev/null "http://127.0.0.1:${port}/health" 2>/dev/null

assert_status() {
  local expected="$1"
  shift
  local actual

  actual="$(curl -sS -o /dev/null -w "%{http_code}" "$@")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected HTTP ${expected}, got ${actual}" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

assert_status 200 "http://127.0.0.1:${port}/health"
assert_status 401 "http://127.0.0.1:${port}/api/athlete"
assert_status 401 \
  -H "Authorization: Bearer wrong-token" \
  "http://127.0.0.1:${port}/api/athlete"
assert_status 405 -X POST "http://127.0.0.1:${port}/health"
assert_status 404 \
  -H "Authorization: Bearer ${proxy_token}" \
  "http://127.0.0.1:${port}/api/unknown"
assert_status 400 \
  -H "Authorization: Bearer ${proxy_token}" \
  "http://127.0.0.1:${port}/api/activities"

echo "Smoke tests passed."
