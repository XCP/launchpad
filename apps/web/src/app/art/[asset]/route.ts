import {
  getMetadataEdgeCache,
  getMetadataRuntime,
  resolveMetadataArtLocation,
} from "@/lib/metadata";
import { CDN_BASE } from "@/lib/constants";

/**
 * Resolves a launch's hero art wherever it actually lives: an owner-authorized
 * original hosted here, then a deliberately maintained mirror, then
 * cdn.xcp.io. The local copy must win: the metadata editor replaces i/<ASSET>,
 * while the CDN may retain the image it ingested when the asset was created.
 * Checking the CDN first made a successful owner edit invisible indefinitely.
 *
 * cdn.xcp.io serves 200 image/png with
 * `x-cdn-placeholder: 1` for anything it hasn't crawled — not a 404 — and
 * that header isn't in the CORS-exposed safelist, so a browser can never read
 * it on a cross-origin fetch to cdn.xcp.io. Checked here, server-side, where
 * CORS doesn't apply.
 *
 * The location lookup is edge-cached for five minutes and explicitly evicted
 * by the editor. The object itself is read directly from R2 rather than by
 * self-fetching /i/<ASSET>, which is unreliable from inside the same Worker.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset: rawAsset } = await params;
  const asset = rawAsset.toUpperCase();
  const cache = getMetadataEdgeCache();
  const { bucket, ctx } = await getMetadataRuntime();

  const stored = await resolveMetadataArtLocation(bucket, cache, ctx, asset);
  if (stored) {
    const object = await bucket.get(stored.key);
    if (object) {
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType ?? "image/png",
          // The editor updates its own mounted images immediately. A short
          // browser TTL makes previously open asset pages self-heal too.
          "cache-control":
            stored.kind === "original"
              ? "public, max-age=60"
              : "public, max-age=300",
          "access-control-allow-origin": "*",
        },
      });
    }
  }

  try {
    // Server-side proxy: a stalled CDN holds this Worker invocation open, and
    // the catch that falls back to our own copy only runs on a settled failure.
    const cdn = await fetch(`${CDN_BASE}/img/full/${asset}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (cdn.ok && cdn.headers.get("x-cdn-placeholder") !== "1") {
      return new Response(cdn.body, {
        headers: {
          "content-type": cdn.headers.get("content-type") ?? "image/png",
          "cache-control": "public, max-age=3600",
          "access-control-allow-origin": "*",
        },
      });
    }
  } catch {
    // cdn.xcp.io unreachable — fall through to the honest miss below
  }

  return new Response("Not found", { status: 404 });
}
