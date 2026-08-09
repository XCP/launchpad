import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

/**
 * R2-backed incremental cache. Without it the adapter resolves to a "dummy"
 * cache and NOTHING persists: every `export const revalidate` and every
 * `next: { revalidate }` in the API layer is silently ignored, so each
 * request re-runs the full Counterparty fan-out cold. That is what took the
 * index down — not the fan-out itself, but running it once per visitor.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
