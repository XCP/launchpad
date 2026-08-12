import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

/**
 * R2-backed incremental cache. Without it the adapter resolves to a "dummy"
 * cache and NOTHING persists: every `export const revalidate` and every
 * `next: { revalidate }` in the API layer is silently ignored, so each
 * request re-runs the full Counterparty fan-out cold. That is what took the
 * index down — not the fan-out itself, but running it once per visitor.
 */
/**
 * KNOWN, UNFIXED FROM CODE: every cached page ships
 * `stale-while-revalidate=2592000` — thirty days — no matter what
 * `expireTime` says in next.config.ts.
 *
 * The adapter writes that number itself. In
 * @opennextjs/aws/dist/core/routing/util.js, `fixSWRCacheHeader` substitutes
 * the literal 2592000, and the cache-HIT branch rebuilds the header as
 * `s-maxage=${remainingTtl}, stale-while-revalidate=2592000` unconditionally.
 * Next's own config never gets a say, and there is no override hook.
 *
 * What it costs: past the freshness window a browser may serve the copy it
 * already has and revalidate behind your back, so the first load after a
 * deploy can show the old page while the reload shows the new one. It reads
 * exactly like a deploy that failed, and it has already been mistaken for
 * one.
 *
 * The fix is a zone-level Cloudflare Transform Rule rewriting Cache-Control
 * on HTML responses — dashboard, not code. Worth pairing with the existing
 * Cache Rule that makes api.xcp.fun serve stale responses, since that is the
 * same zone and the same class of surprise.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
