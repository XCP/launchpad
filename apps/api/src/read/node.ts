/** Read-only fallback for routine protocol reads that the first-party index cannot answer. Wallet
 * composition, broadcasts and Electrs spend checks use the node directly. Never parse response JSON
 * (quantities exceed 2^53) or introduce automatic upstream retries here. Counterparty's own public
 * cache policy is preserved at our edge: stripping its max-age made every tab re-hit the upstream,
 * which defeated the gateway's original purpose. */
import { Hono } from "hono";
import type { Env } from "#api/env";
import { retryAfterDeadline } from "#api/integrations/cooldown";
import { counterpartyApiBase } from "#api/integrations/counterparty";

const MAX_PATH = 1_024;
const MAX_QUERY = 32_768;
const ADDRESS = /^[A-Za-z0-9]{26,90}$/;
const HASH = /^[a-fA-F0-9]{64}$/;
const UTXO = /^[a-fA-F0-9]{64}:(0|[1-9][0-9]{0,9})$/;
const ASSET = /^[A-Za-z0-9_.!@-]{1,250}$/;
const EVENT = /^[A-Z][A-Z0-9_]{0,79}$/;
const FIRST_PARTY_ORIGINS = new Set(["https://xcp.fun", "https://www.xcp.fun"]);
const MAX_CACHE_SECONDS = 300;
const names = (value: string) => new Set(value.split(/\s+/).filter(Boolean));

const READ_PARAMS = names(`limit cursor verbose status sort type addresses event_name
  exclude_with_oracle quantity quantity_a quantity_b min_quantity_a min_quantity_b
  start_block end_block block_index`);

/** Decode exactly once, forbid path delimiters/traversal, then build the URL from a fixed origin. */
function targetFor(pathname: string): string | null {
  if (pathname.length > MAX_PATH) return null;
  const prefix = "/node/v2";
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  let parts: string[];
  try {
    const tail = pathname.slice(prefix.length).replace(/\/$/, "");
    parts = tail === "" ? [] : tail.slice(1).split("/").map(decodeURIComponent);
  } catch { return null; }
  if (parts.some(p => !p || p === "." || p === ".." || /[\\/%\u0000-\u0020\u007f]/.test(p))) return null;
  const path = `/${parts.map(encodeURIComponent).join("/")}`;
  const [kind, id, action, detail, extra] = parts;
  const n = parts.length;
  const target = `${counterpartyApiBase()}${path}`;
  if (n === 0) return target;
  if (kind === "bitcoin" && id === "transactions") {
    return n === 3 && HASH.test(action) ? target : null;
  }
  if (kind === "blocks") return n === 2 && (id === "last" || /^\d{1,10}$/.test(id)) ? target : null;
  if (kind === "addresses" && n === 2 && id === "mempool") return target;
  if ((kind === "addresses" && ADDRESS.test(id)) || (kind === "utxos" && UTXO.test(id))) {
    if (action === "balances" && (n === 3 || (kind === "addresses" && n === 4 && ASSET.test(detail)))) return target;
    if (kind === "addresses" && ((n === 3 && /^(credits|debits|pools|orders|fairminters|fairmints|dispensers)$/.test(action)) ||
      (n === 4 && action === "fairmints" && ASSET.test(detail)))) return target;
    return null;
  }
  if (kind === "assets" && ASSET.test(id)) {
    return n === 2 || (n === 3 && /^(fairminters|fairmints|issuances|holders|balances|dispensers|destructions)$/.test(action))
      ? target : null;
  }
  if (kind === "fairminters") return n === 1 || (HASH.test(id) && (n === 2 || (n === 3 && action === "fairmints"))) ? target : null;
  if (kind === "transactions" && HASH.test(id)) {
    return n === 2 || (action === "events" && (n === 3 || (n === 4 && EVENT.test(detail)))) ? target : null;
  }
  if (kind === "mempool") {
    return (id === "events" && (n === 2 || (n === 3 && EVENT.test(action)))) ||
      (id === "transactions" && HASH.test(action) && n === 4 && detail === "events") ? target : null;
  }
  if (kind === "orders" && n === 2 && HASH.test(id)) return target;
  if ((kind === "pools" || kind === "orders") && ASSET.test(id) && ASSET.test(action)) {
    if (n === 3 || (n === 4 && detail === "matches")) return target;
    if (kind === "pools" && ((n === 4 && /^(price_history|quote)$/.test(detail)) ||
      (n === 5 && detail === "quote" && /^(deposit|withdraw)$/.test(extra)))) return target;
  }
  return null;
}

function validQuery(url: URL): boolean {
  if (url.search.length > MAX_QUERY) return false;
  const seen = new Set<string>();
  let count = 0;
  for (const [key, value] of url.searchParams) {
    if (++count > 64 || value.length > 16_384 || /[\u0000-\u001f\u007f]/.test(value)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    if (!READ_PARAMS.has(key)) return false;
    if (key === "limit" && (!/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1_000)) return false;
    if (key === "cursor" && value.length > 512) return false;
    if (key === "addresses" && (value.split(",").length > 6 || value.split(",").some(v => !ADDRESS.test(v)))) return false;
  }
  return true;
}

const responseHeaders = (origin: string | null, cacheControl = "no-store") => {
  const headers = new Headers({
    "cache-control": cacheControl,
    // The gateway must execute on every request so CORS and the per-caller budget cannot be skipped.
    // Browsers still honor Cache-Control, while our explicit Cache API copy absorbs upstream reads.
    "cloudflare-cdn-cache-control": "no-store",
    "access-control-allow-headers": "Accept, Content-Type",
    "access-control-expose-headers": "Retry-After, X-XCP-Proxy-Cache",
    "vary": "Origin",
    "x-robots-tag": "noindex, nofollow",
  });
  if (origin && FIRST_PARTY_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  return headers;
};
const errorResponse = (error: string, status: number, origin: string | null, extra?: Record<string, string>) => {
  const headers = responseHeaders(origin);
  headers.set("content-type", "application/json");
  for (const [key, value] of Object.entries(extra ?? {})) headers.set(key, value);
  return new Response(JSON.stringify({ error }), { status, headers });
};

/** Use one canonical key across the custom domain, workers.dev and service bindings. Query parameter
 * order is not semantically significant here (duplicates were rejected above), so sorting also stops
 * callers from manufacturing cache misses by shuffling an otherwise identical query. */
const cacheKey = (url: URL) => {
  const canonical = new URL(url);
  canonical.protocol = "https:";
  canonical.host = "api.xcp.fun";
  canonical.searchParams.sort();
  return new Request(canonical.toString(), { method: "GET" });
};

/** Counterparty owns the freshness decision. Admit only an explicit public max-age, clamp an
 * unexpectedly large value, and keep mempool/no-store responses live. */
function cacheControl(upstream: Headers): string {
  const value = upstream.get("cache-control") ?? "";
  if (/\b(?:no-store|private)\b/i.test(value) || !/\bpublic\b/i.test(value)) return "no-store";
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(value);
  if (!match) return "no-store";
  const seconds = Math.min(Number(match[1]), MAX_CACHE_SECONDS);
  return Number.isSafeInteger(seconds) && seconds > 0 ? `public, max-age=${seconds}` : "no-store";
}

function clientResponse(response: Response, origin: string | null, cacheStatus: "HIT" | "MISS", control: string) {
  const headers = responseHeaders(origin, control);
  headers.set("x-xcp-proxy-cache", cacheStatus);
  for (const key of ["content-type", "content-encoding", "retry-after"]) {
    const value = response.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// A refusal observed by browser traffic must not consume the indexer's permits or prevent a cron
// from progressing. This gate shares only a deadline in this isolate, not bodies,
// promises, a global quota, or user wallet state. Concurrent refusals can only extend it.
let cooldown = 0;
export const nodeRoute = new Hono<{ Bindings: Env }>();
nodeRoute.all("/node/*", async (c) => {
  const url = new URL(c.req.url);
  const origin = c.req.header("origin") ?? null;
  // This is a useful compatibility layer for our own browser, not a public API product. An explicit
  // outside browser origin is cheap to reject and removes the easiest form of third-party reuse.
  // Non-browser clients do not send Origin, so the per-caller ceiling below remains the real backstop.
  if (origin && !FIRST_PARTY_ORIGINS.has(origin)) {
    return errorResponse("This first-party compatibility gateway is not available to external browser origins", 403, null);
  }
  const target = targetFor(url.pathname);
  if (!target) return errorResponse("Unsupported node operation", 404, origin);
  if (c.req.method === "OPTIONS") {
    const headers = responseHeaders(origin);
    headers.set("access-control-allow-methods", "GET, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  if (c.req.method !== "GET") return errorResponse("Method not allowed", 405, origin, { allow: "GET, OPTIONS" });
  if (!validQuery(url)) return errorResponse("Invalid node query", 400, origin);
  if (c.req.raw.body) {
    void c.req.raw.body.cancel().catch(() => undefined);
    return errorResponse("Request body is not supported", 400, origin);
  }

  const actor = c.req.header("cf-connecting-ip") ?? "unattributed";
  const admission = await c.env.NODE_PUBLIC_RATE_LIMITER.limit({ key: actor });
  if (!admission.success) {
    return errorResponse(
      "First-party compatibility gateway limit reached; external integrations should use api.counterparty.io",
      429,
      origin,
      { "retry-after": "60" },
    );
  }

  // A hit is safe even during an upstream cooldown: it performs no upstream request. The cache holds
  // only successful responses for exactly the freshness window Counterparty itself advertised.
  const key = cacheKey(url);
  if (typeof caches !== "undefined") {
    const hit = await caches.default.match(key);
    if (hit) return clientResponse(hit, origin, "HIT", hit.headers.get("cache-control") ?? "no-store");
  }
  const remaining = cooldown - Date.now();
  if (remaining > 0) return errorResponse("Upstream is rate limited; retry after the indicated delay", 429, origin, {
    "retry-after": String(Number.isFinite(remaining) ? Math.ceil(remaining / 1_000) : 31_536_000),
  });
  let upstream: Response;
  try {
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(15_000)]);
    signal.throwIfAborted();
    upstream = await fetch(`${target}${url.search}`, {
      method: "GET",
      // Never forward caller cookies, credentials or signing material.
      headers: { accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    return errorResponse("Node temporarily unavailable", error instanceof Error && /^(TimeoutError|AbortError)$/.test(error.name) ? 504 : 502, origin);
  }
  if (upstream.status === 429) {
    const now = Date.now();
    cooldown = Math.max(cooldown,
      retryAfterDeadline(upstream.headers.get("retry-after"), now) ?? now + 30_000);
  }
  // Do not follow (or expose Location from) a redirect to an unapproved host. Other statuses,
  // including missing/pending transactions, 429 and 503, retain their raw protocol response.
  if (upstream.status >= 300 && upstream.status < 400) {
    void upstream.body?.cancel().catch(() => undefined);
    return errorResponse("Unexpected node redirect", 502, origin);
  }

  const control = cacheControl(upstream.headers);
  const response = clientResponse(upstream, origin, "MISS", control);
  if (upstream.ok && control !== "no-store" && typeof caches !== "undefined") {
    const stored = response.clone();
    // CORS is a property of this caller, not of the protocol answer. Add it after a hit so one origin
    // can never populate another origin's access-control header.
    stored.headers.delete("access-control-allow-origin");
    stored.headers.delete("access-control-allow-headers");
    stored.headers.delete("access-control-expose-headers");
    stored.headers.delete("cloudflare-cdn-cache-control");
    stored.headers.delete("vary");
    stored.headers.delete("x-xcp-proxy-cache");
    stored.headers.delete("x-robots-tag");
    c.executionCtx.waitUntil(caches.default.put(key, stored).catch(() => undefined));
  }
  return response;
});
