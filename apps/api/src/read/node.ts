/** Read-only fallback for routine protocol reads that the first-party index cannot answer. Wallet
 * composition, broadcasts and Electrs spend checks use the node directly. Never parse response JSON
 * (quantities exceed 2^53), cache live state, or introduce automatic upstream retries here. */
import { Hono } from "hono";
import type { Env } from "#api/env";
import { retryAfterDeadline } from "#api/integrations/cooldown";

const COUNTERPARTY = "https://api.counterparty.io:4000/v2";
const MAX_PATH = 1_024;
const MAX_QUERY = 32_768;
const ADDRESS = /^[A-Za-z0-9]{26,90}$/;
const HASH = /^[a-fA-F0-9]{64}$/;
const UTXO = /^[a-fA-F0-9]{64}:(0|[1-9][0-9]{0,9})$/;
const ASSET = /^[A-Za-z0-9_.!@-]{1,250}$/;
const EVENT = /^[A-Z][A-Z0-9_]{0,79}$/;
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
  const target = `${COUNTERPARTY}${path}`;
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

const responseHeaders = () => new Headers({
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Accept, Content-Type",
  "access-control-expose-headers": "Retry-After",
});
const errorResponse = (error: string, status: number, extra?: Record<string, string>) => {
  const headers = responseHeaders();
  headers.set("content-type", "application/json");
  for (const [key, value] of Object.entries(extra ?? {})) headers.set(key, value);
  return new Response(JSON.stringify({ error }), { status, headers });
};

// A refusal observed by browser traffic must not consume the indexer's permits or prevent a cron
// from progressing. This gate shares only a deadline in this isolate, not bodies,
// promises, a global quota, or user wallet state. Concurrent refusals can only extend it.
let cooldown = 0;
export const nodeRoute = new Hono<{ Bindings: Env }>();
nodeRoute.all("/node/*", async (c) => {
  const url = new URL(c.req.url);
  const target = targetFor(url.pathname);
  if (!target) return errorResponse("Unsupported node operation", 404);
  if (c.req.method === "OPTIONS") {
    const headers = responseHeaders();
    headers.set("access-control-allow-methods", "GET, OPTIONS");
    return new Response(null, { status: 204, headers });
  }
  if (c.req.method !== "GET") return errorResponse("Method not allowed", 405, { allow: "GET, OPTIONS" });
  if (!validQuery(url)) return errorResponse("Invalid node query", 400);
  if (c.req.raw.body) {
    void c.req.raw.body.cancel().catch(() => undefined);
    return errorResponse("Request body is not supported", 400);
  }
  const remaining = cooldown - Date.now();
  if (remaining > 0) return errorResponse("Upstream is rate limited; retry after the indicated delay", 429, {
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
    return errorResponse("Node temporarily unavailable", error instanceof Error && /^(TimeoutError|AbortError)$/.test(error.name) ? 504 : 502);
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
    return errorResponse("Unexpected node redirect", 502);
  }
  const headers = responseHeaders();
  for (const key of ["content-type", "content-encoding", "retry-after"]) {
    const value = upstream.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
});
