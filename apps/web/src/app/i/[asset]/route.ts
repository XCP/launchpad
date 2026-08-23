import {
  METADATA_ORIGIN,
  getMetadataEdgeCache,
  getMetadataRuntime,
  metadataCacheKey,
} from "@/lib/metadata";
import { CDN_BASE } from "@/lib/constants";

/**
 * A replaceable image cannot be `immutable`. The edit panel rewrites this
 * object in place at a URL that never changes, so a year-long browser TTL
 * with no revalidation meant a replaced image stayed replaced for everyone
 * except the caches. Shared caches still hold it for a year — the editor
 * evicts them on write (purgeMetadataCache) — and an hour is what a browser
 * keeps, which self-heals a replacement without re-fetching hero art on
 * every navigation.
 */
const IMAGE_CACHE_CONTROL = "public, max-age=3600, s-maxage=31536000";

/**
 * Serves a launch's uploaded token image — and for everything else, a 302 to
 * the CDN's copy rather than a 404. The chain still prefers our original
 * (every launch created here uploads its art to R2 before broadcast), but a
 * miss is expected and constant for non-launch assets like XCP, and a page
 * of chips each logging an honest 404 reads as a broken site in the console.
 * The redirect carries the same answer the client-side fallback would have
 * reached anyway, silently.
 *
 * `fb` names the CDN size to fall back to: "full" for hero-sized art,
 * anything else (or nothing) gets the icon.
 *
 * `w` optionally asks for a resized copy. Without it this route returns the
 * stored original byte-for-byte, which is what on-chain metadata points at and
 * must never change. With it, the bytes are the same picture at a sane size:
 * the homepage renders 56 of these at 280x280 and was pulling 34.3MB of
 * full-resolution originals to do it -- single images up to 1.99MB, one of
 * them 1280x1223 to fill a 280px box.
 *
 * Resizing goes through the same fetch `cf.image` path /icon/<ASSET> already
 * uses, rather than the Images binding (this Worker has none). The inner fetch
 * deliberately omits `w`, so it takes the original branch below and cannot
 * recurse; if the object is missing it follows the 302 and resizes the CDN
 * copy instead, which is the right answer either way. Zone features do not run
 * on workers.dev, so a failed transform falls through to the original rather
 * than erroring.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  const requested = new URL(request.url).searchParams.get("w");
  const width = requested && /^\d{1,4}$/.test(requested) ? Number(requested) : 0;

  if (width >= 16 && width <= 2048) {
    const source = `${METADATA_ORIGIN}/i/${encodeURIComponent(asset.toUpperCase())}`;
    const res = await fetch(source, {
      cf: {
        // scale-down, not contain: contain enlarges a source smaller than the
        // requested width, and re-encoding an upscale is strictly worse than
        // sending the original. CAPTAINDAN is 226x226 and 30,106 bytes; asking
        // contain for 560 returned 201,194 -- nearly 7x larger -- on the most
        // requested asset on the site. scale-down never enlarges, so a small
        // source passes through at its own size.
        image: { format: "auto", fit: "scale-down", width },
        cacheEverything: true,
      },
    } as RequestInit);
    if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) {
      return new Response(res.body, {
        headers: {
          "content-type": res.headers.get("content-type") ?? "image/png",
          "cache-control": IMAGE_CACHE_CONTROL,
          "access-control-allow-origin": "*",
        },
      });
    }
  }

  const normalizedAsset = asset.toUpperCase();
  const cache = getMetadataEdgeCache();
  const cacheKey = metadataCacheKey(`/i/${encodeURIComponent(normalizedAsset)}`);
  const cached = await cache?.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-metadata-cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const { bucket, ctx } = await getMetadataRuntime();
  const object = await bucket.get(`i/${normalizedAsset}`);
  if (!object) {
    const fb = new URL(request.url).searchParams.get("fb") === "full" ? "full" : "icon";
    return new Response(null, {
      status: 302,
      headers: {
        location: `${CDN_BASE}/img/${fb}/${encodeURIComponent(normalizedAsset)}`,
        // Short-lived: launches upload art before broadcast, so a cached
        // redirect can only ever cover assets that were never ours to serve.
        "cache-control": "public, max-age=300",
      },
    });
  }
  const response = new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": IMAGE_CACHE_CONTROL,
      "access-control-allow-origin": "*",
      "x-metadata-cache": "MISS",
    },
  });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
  return response;
}
