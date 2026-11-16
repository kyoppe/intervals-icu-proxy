interface Env {
  INTERVALS_API_KEY?: string;
  INTERVALS_ATHLETE_ID?: string;
  PROXY_BEARER_TOKEN?: string;
  DD_API_KEY?: string;
  DD_ENV?: string;
  DD_SERVICE?: string;
  DD_VERSION?: string;
  DD_METRIC_PREFIX?: string;
}

type EndpointTemplate =
  | "/health"
  | "/api/athlete"
  | "/api/activities"
  | "/api/activities/:id"
  | "/api/wellness"
  | "/api/events"
  | "unknown";

type Outcome =
  | "success"
  | "auth_failed"
  | "upstream_error"
  | "method_not_allowed"
  | "not_found"
  | "client_error"
  | "server_error";

interface TelemetryState {
  endpoint: EndpointTemplate;
  authFailure: boolean;
  upstreamError: boolean;
  upstreamLatencyMs?: number;
}

interface RequestObservation {
  endpoint: EndpointTemplate;
  status: number;
  outcome: Outcome;
  totalLatencyMs: number;
  upstreamLatencyMs?: number;
}

interface DatadogMetricSeries {
  metric: string;
  type: 1 | 3;
  interval?: number;
  points: Array<{ timestamp: number; value: number }>;
  tags: string[];
}

const UPSTREAM_BASE_URL = "https://intervals.icu/api/v1";
const UPSTREAM_ORIGIN = "https://intervals.icu";
const DATADOG_METRICS_URL = "https://api.datadoghq.com/api/v2/series";
const UPSTREAM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const METRIC_NAMESPACE = "intervals_icu_proxy.";
const DEFAULT_ENV = "production";
const DEFAULT_SERVICE = "intervals-icu-proxy";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  });
}

function errorResponse(error: string, status: number, headers?: HeadersInit): Response {
  return jsonResponse({ error }, status, headers);
}

function getEndpointTemplate(pathname: string): EndpointTemplate {
  if (pathname === "/health") {
    return "/health";
  }
  if (pathname === "/api/athlete") {
    return "/api/athlete";
  }
  if (pathname === "/api/activities") {
    return "/api/activities";
  }
  if (/^\/api\/activities\/[^/]+$/.test(pathname)) {
    return "/api/activities/:id";
  }
  if (pathname === "/api/wellness") {
    return "/api/wellness";
  }
  if (pathname === "/api/events") {
    return "/api/events";
  }

  return "unknown";
}

function getStatusClass(status: number): string {
  if (status < 200) {
    return "1xx";
  }
  if (status < 300) {
    return "2xx";
  }
  if (status < 400) {
    return "3xx";
  }
  if (status < 500) {
    return "4xx";
  }
  return "5xx";
}

function getOutcome(status: number, state: TelemetryState): Outcome {
  if (state.authFailure) {
    return "auth_failed";
  }
  if (state.upstreamError) {
    return "upstream_error";
  }
  if (status === 405) {
    return "method_not_allowed";
  }
  if (status === 404) {
    return "not_found";
  }
  if (status >= 500) {
    return "server_error";
  }
  if (status >= 400) {
    return "client_error";
  }
  return "success";
}

function normalizeMetricPrefix(value: string | undefined): string | null {
  if (value === undefined) {
    return "";
  }

  const withoutTrailingDots = value.trim().replace(/\.+$/, "");

  if (
    withoutTrailingDots.length === 0 ||
    !/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/.test(withoutTrailingDots)
  ) {
    return null;
  }

  return `${withoutTrailingDots}.`;
}

function resolveMetricPrefix(value: string | undefined): string | null {
  const customPrefix = normalizeMetricPrefix(value);

  return customPrefix === null ? null : `${customPrefix}${METRIC_NAMESPACE}`;
}

function normalizeTagValue(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();

  return candidate && /^[A-Za-z0-9_.-]+$/.test(candidate) ? candidate : fallback;
}

function getTelemetryTags(env: Env, observation: RequestObservation): string[] {
  const tags = [
    `endpoint:${observation.endpoint}`,
    `status_class:${getStatusClass(observation.status)}`,
    `outcome:${observation.outcome}`,
    `env:${normalizeTagValue(env.DD_ENV, DEFAULT_ENV)}`,
    `service:${normalizeTagValue(env.DD_SERVICE, DEFAULT_SERVICE)}`,
  ];
  const version = env.DD_VERSION?.trim();

  if (version && /^[0-9a-f]{7,40}$/i.test(version)) {
    tags.push(`version:${version}`);
  }

  return tags;
}

function createMetricSeries(
  prefix: string,
  suffix: string,
  type: 1 | 3,
  value: number,
  timestamp: number,
  tags: string[],
): DatadogMetricSeries {
  const series: DatadogMetricSeries = {
    metric: `${prefix}${suffix}`,
    type,
    points: [{ timestamp, value }],
    tags,
  };

  if (type === 1) {
    series.interval = 1;
  }

  return series;
}

function getDatadogLogTags(env: Env): string {
  const tags = [
    `env:${normalizeTagValue(env.DD_ENV, DEFAULT_ENV)}`,
    `service:${normalizeTagValue(env.DD_SERVICE, DEFAULT_SERVICE)}`,
  ];
  const version = env.DD_VERSION?.trim();

  if (version && /^[0-9a-f]{7,40}$/i.test(version)) {
    tags.push(`version:${version}`);
  }

  return tags.join(",");
}

function logDatadogSubmissionFailure(
  env: Env,
  eventType: "datadog_metrics_rejected" | "datadog_metrics_send_failed",
  phase: "request_init" | "fetch" | "response",
  statusCode: number,
  error?: unknown,
): void {
  const log: Record<string, string | number> = {
    ddtags: getDatadogLogTags(env),
    event_type: eventType,
    message: "Datadog metrics submission failed",
    phase,
    service: normalizeTagValue(env.DD_SERVICE, DEFAULT_SERVICE),
    status_code: statusCode,
  };

  if (error) {
    log.error_cause_code = getSafeErrorCauseCode(error);
    log.error_name = error instanceof Error && error.name ? error.name : "UnknownError";
  }

  console.error(JSON.stringify(log));
}

async function sendDatadogTelemetry(
  env: Env,
  observation: RequestObservation,
): Promise<void> {
  const apiKey = env.DD_API_KEY?.trim();
  const prefix = resolveMetricPrefix(env.DD_METRIC_PREFIX);

  if (!apiKey || !prefix) {
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const tags = getTelemetryTags(env, observation);
  const series = [
    createMetricSeries(prefix, "requests", 1, 1, timestamp, tags),
    createMetricSeries(
      prefix,
      "request_latency_ms",
      3,
      observation.totalLatencyMs,
      timestamp,
      tags,
    ),
  ];

  if (observation.upstreamLatencyMs !== undefined) {
    series.push(
      createMetricSeries(
        prefix,
        "upstream_latency_ms",
        3,
        observation.upstreamLatencyMs,
        timestamp,
        tags,
      ),
    );
  }

  if (observation.outcome === "upstream_error") {
    series.push(createMetricSeries(prefix, "upstream_errors", 1, 1, timestamp, tags));
  }

  if (observation.outcome === "auth_failed") {
    series.push(createMetricSeries(prefix, "auth_failures", 1, 1, timestamp, tags));
  }

  let request: Request;

  try {
    request = new Request(DATADOG_METRICS_URL, {
      body: JSON.stringify({ series }),
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": apiKey,
      },
      method: "POST",
      redirect: "manual",
    });
  } catch (error) {
    logDatadogSubmissionFailure(
      env,
      "datadog_metrics_send_failed",
      "request_init",
      502,
      error,
    );
    return;
  }

  try {
    const response = await fetch(request);

    if (!response.ok) {
      logDatadogSubmissionFailure(
        env,
        "datadog_metrics_rejected",
        "response",
        response.status,
      );
    }
  } catch (error) {
    logDatadogSubmissionFailure(env, "datadog_metrics_send_failed", "fetch", 502, error);
    // Telemetry failures must never affect the proxy response.
  }
}

function scheduleDatadogTelemetry(
  ctx: ExecutionContext,
  env: Env,
  observation: RequestObservation,
): void {
  if (!env.DD_API_KEY?.trim() || !resolveMetricPrefix(env.DD_METRIC_PREFIX)) {
    return;
  }

  ctx.waitUntil(sendDatadogTelemetry(env, observation));
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function getDateRange(url: URL): { oldest: string; newest: string } | null {
  const oldestValues = url.searchParams.getAll("oldest");
  const newestValues = url.searchParams.getAll("newest");
  const queryKeys = [...url.searchParams.keys()];

  if (
    oldestValues.length !== 1 ||
    newestValues.length !== 1 ||
    queryKeys.some((key) => key !== "oldest" && key !== "newest")
  ) {
    return null;
  }

  const oldest = oldestValues[0];
  const newest = newestValues[0];

  if (!isIsoDate(oldest) || !isIsoDate(newest) || oldest > newest) {
    return null;
  }

  return { oldest, newest };
}

function getAthleteId(env: Env): string {
  return env.INTERVALS_ATHLETE_ID?.trim() || "0";
}

function buildUpstreamUrl(path: string, query?: Record<string, string>): URL {
  const url = new URL(`${UPSTREAM_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  return url;
}

async function sha256(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;

  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index];
  }

  return difference === 0;
}

async function authenticate(request: Request, env: Env): Promise<Response | null> {
  const expectedToken = env.PROXY_BEARER_TOKEN;

  if (!expectedToken) {
    return errorResponse("server_misconfigured", 500);
  }

  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);

  if (!match || !(await constantTimeEqual(match[1], expectedToken))) {
    return errorResponse("unauthorized", 401, {
      "www-authenticate": "Bearer",
    });
  }

  return null;
}

function upstreamAuthorization(apiKey: string): string {
  return `Basic ${btoa(`API_KEY:${apiKey}`)}`;
}

function getSafeErrorCauseCode(error: unknown): string {
  if (!(error instanceof Error) || !("cause" in error)) {
    return "none";
  }

  const cause = error.cause;

  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return "none";
  }

  const code = cause.code;

  return typeof code === "string" && /^[A-Za-z0-9_.-]+$/.test(code) ? code : "none";
}

function logUpstreamFetchFailure(env: Env, endpoint: EndpointTemplate, error: unknown): void {
  const errorName = error instanceof Error && error.name ? error.name : "UnknownError";

  console.error(
    JSON.stringify({
      ddtags: getDatadogLogTags(env),
      endpoint,
      error_cause_code: getSafeErrorCauseCode(error),
      error_name: errorName,
      event_type: "upstream_fetch_failed",
      message: "Intervals.icu fetch failed",
      service: normalizeTagValue(env.DD_SERVICE, DEFAULT_SERVICE),
      status_code: 502,
    }),
  );
}

async function fetchUpstream(upstreamUrl: URL, apiKey: string): Promise<Response> {
  const headers = {
    Accept: "application/json",
    Authorization: upstreamAuthorization(apiKey),
    "User-Agent": UPSTREAM_USER_AGENT,
  };
  let currentUrl = upstreamUrl;
  let response = await fetch(currentUrl, {
    headers,
    method: "GET",
    redirect: "manual",
  });

  for (let redirectCount = 0; redirectCount < 3; redirectCount += 1) {
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("Location");

    if (!location) {
      return response;
    }

    const nextUrl = new URL(location, currentUrl);

    if (nextUrl.origin !== UPSTREAM_ORIGIN) {
      return response;
    }

    currentUrl = nextUrl;
    response = await fetch(currentUrl, {
      headers,
      method: "GET",
      redirect: "manual",
    });
  }

  return response;
}

async function proxyJson(
  upstreamUrl: URL,
  env: Env,
  telemetryState: TelemetryState,
): Promise<Response> {
  const apiKey = env.INTERVALS_API_KEY;

  if (!apiKey) {
    return errorResponse("server_misconfigured", 500);
  }

  let upstreamResponse: Response;
  const upstreamStartedAt = performance.now();

  try {
    upstreamResponse = await fetchUpstream(upstreamUrl, apiKey);
    telemetryState.upstreamLatencyMs = performance.now() - upstreamStartedAt;
  } catch (error) {
    telemetryState.upstreamLatencyMs = performance.now() - upstreamStartedAt;
    telemetryState.upstreamError = true;
    logUpstreamFetchFailure(env, telemetryState.endpoint, error);
    return errorResponse("upstream_unavailable", 502);
  }

  if (!upstreamResponse.ok) {
    telemetryState.upstreamError = true;
    return errorResponse("upstream_error", 502);
  }

  try {
    const body = await upstreamResponse.json();
    return jsonResponse(body, upstreamResponse.status);
  } catch {
    telemetryState.upstreamError = true;
    return errorResponse("upstream_invalid_response", 502);
  }
}

function getActivityId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/activities\/([^/]+)$/);

  if (!match) {
    return null;
  }

  let activityId: string;

  try {
    activityId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  if (
    activityId.length === 0 ||
    activityId.length > 200 ||
    activityId.includes("/") ||
    activityId.includes("\\")
  ) {
    return null;
  }

  return activityId;
}

async function handleApiRequest(
  url: URL,
  request: Request,
  env: Env,
  telemetryState: TelemetryState,
): Promise<Response> {
  const authenticationError = await authenticate(request, env);

  if (authenticationError) {
    telemetryState.authFailure = authenticationError.status === 401;
    return authenticationError;
  }

  const athleteId = encodeURIComponent(getAthleteId(env));

  if (url.pathname === "/api/athlete" && url.search === "") {
    return proxyJson(buildUpstreamUrl(`/athlete/${athleteId}`), env, telemetryState);
  }

  const activityId = getActivityId(url.pathname);

  if (activityId !== null && url.search === "") {
    return proxyJson(
      buildUpstreamUrl(`/activity/${encodeURIComponent(activityId)}`),
      env,
      telemetryState,
    );
  }

  if (
    url.pathname === "/api/activities" ||
    url.pathname === "/api/wellness" ||
    url.pathname === "/api/events"
  ) {
    const dateRange = getDateRange(url);

    if (!dateRange) {
      return errorResponse("invalid_date_range", 400);
    }

    const upstreamPath =
      url.pathname === "/api/activities"
        ? `/athlete/${athleteId}/activities`
        : url.pathname === "/api/wellness"
          ? `/athlete/${athleteId}/wellness`
          : `/athlete/${athleteId}/events`;

    return proxyJson(buildUpstreamUrl(upstreamPath, dateRange), env, telemetryState);
  }

  return errorResponse("not_found", 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startedAt = performance.now();
    const url = new URL(request.url);
    const telemetryState: TelemetryState = {
      authFailure: false,
      endpoint: getEndpointTemplate(url.pathname),
      upstreamError: false,
    };
    let response: Response;

    if (request.method !== "GET") {
      response = errorResponse("method_not_allowed", 405, {
        allow: "GET",
      });
    } else if (url.pathname === "/health" && url.search === "") {
      response = jsonResponse({ ok: true });
    } else if (isApiPath(url.pathname)) {
      response = await handleApiRequest(url, request, env, telemetryState);
    } else {
      response = errorResponse("not_found", 404);
    }

    scheduleDatadogTelemetry(ctx, env, {
      endpoint: telemetryState.endpoint,
      outcome: getOutcome(response.status, telemetryState),
      status: response.status,
      totalLatencyMs: performance.now() - startedAt,
      upstreamLatencyMs: telemetryState.upstreamLatencyMs,
    });

    return response;
  },
};
