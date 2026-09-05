import {
  forgetMetadataArtLocation,
  getMetadataEdgeCache,
  getMetadataRuntime,
  readVersionedImage,
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
 * self-fetching /i/<ASSET>, which is unreliable from inside the same Worker,
 * and its bytes are reused by version the same way /i reuses them: a preview
 * card fetched by every chat client that unfurls a link should not cost a
 * fresh GET each time for a picture that has not changed.
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
    // The editor updates its own mounted images immediately. A short
    // browser TTL makes previously open asset pages self-heal too.
    const cacheControl =
      stored.kind === "original" ? "public, max-age=60" : "public, max-age=300";
    const image = stored.etag
      ? await readVersionedImage(bucket, cache, ctx, asset, stored.etag, [stored.key])
      : null;
    if (image) {
      return new Response(image.body, {
        headers: {
          "content-type": image.contentType ?? "image/png",
          "cache-control": cacheControl,
          "access-control-allow-origin": "*",
          "x-metadata-cache": image.cacheStatus,
        },
      });
    }

    // The remembered version has been replaced or deleted since this edge
    // cached the location. Serve the current object unversioned and forget
    // the location so the next request re-resolves it.
    if (stored.etag) forgetMetadataArtLocation(cache, ctx, asset);
    const object = await bucket.get(stored.key);
    if (object) {
      return new Response(object.body, {
        headers: {
          "content-type": object.httpMetadata?.contentType ?? "image/png",
          "cache-control": cacheControl,
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
