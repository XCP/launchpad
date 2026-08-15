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
 * NO LONGER OBSERVED (adapter 1.20.2, measured 2026-08-15). This note used to
 * read "KNOWN, UNFIXED FROM CODE: every cached page ships
 * stale-while-revalidate=2592000 — thirty days", with the consequence that the
 * first load after a deploy could show the old page while a reload showed the
 * new one, which had already been mistaken for a failed deploy.
 *
 * Six consecutive requests to `/` — one STALE then five HIT, confirmed via
 * x-nextjs-cache — all returned `public, s-maxage=30,
 * stale-while-revalidate=60`. That is Next's own value surviving intact, not
 * the adapter's.
 *
 * The literal is still in the source, so this is "not currently reached"
 * rather than "removed upstream". In
 * @opennextjs/aws/dist/core/routing/util.js the HIT branch is guarded by
 * `NEXT_CACHE === "HIT" && _lastModified > 0`, and _lastModified comes from
 * the AsyncLocalStorage store, which is evidently not populated on this
 * runtime — so the rewrite at that branch never runs and the header is left
 * alone. A future adapter that starts populating it would bring the behaviour
 * back, which is why the reference stays here rather than being deleted.
 *
 * The zone-level Transform Rule this note used to recommend is therefore NOT
 * needed today. Re-measure before adding one: `curl -sI https://xcp.fun/ |
 * grep -i cache-control`, twice, so the second request is a cache HIT.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
