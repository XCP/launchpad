import {
  METADATA_ORIGIN,
  getMetadataEdgeCache,
  getMetadataRuntime,
  metadataImageCacheKey,
  resolveMetadataArtLocation,
} from "@/lib/metadata";
import { CDN_BASE } from "@/lib/constants";

/**
 * A replaceable image cannot be `immutable`. The edit panel rewrites this
 * object in place at a URL that never changes, so a year-long browser TTL
 * with no revalidation meant a replaced image stayed replaced for everyone
 * except the caches. Shared cached bytes are keyed by the R2 object's etag,
 * so an edit cannot hit an older object at another edge location; a browser
 * keeps the public URL for five minutes. That bounds propagation for viewers
 * who already opened the launch without re-fetching card art on every
 * navigation.
 */
const IMAGE_CACHE_CONTROL = "public, max-age=300, s-maxage=31536000";

/**
 * A MIRROR is not an original, and must not be cached like one.
 *
 * `i/<ASSET>` is art a launch uploaded here before broadcast: written once,
 * pointed at by a locked on-chain description, evicted by the editor when the
 * owner replaces it. That is what earns a year in shared caches.
 *
 * `m/<ASSET>` is our copy of art belonging to a launch opened somewhere else.
 * Nothing on-chain points at it — the description names the creator's own
 * host — so it is a display cache and nothing more, and whoever owns the real
 * file can change it whenever they like. A year would be a promise about
 * somebody else's server. Five minutes matches the CDN-fallback redirect
 * below, and is short enough that a refresh actually reaches people.
 */
const MIRROR_CACHE_CONTROL = "public, max-age=300";

/**
 * Serves a launch's uploaded token image — then our mirror of a foreign
 * launch's art, and for everything else a 302 to the CDN's copy rather than a
 * 404. The chain prefers our original (every launch created here uploads its
 * art to R2 before broadcast), but a miss is expected and constant for
 * non-launch assets like XCP, and a page of chips each logging an honest 404
 * reads as a broken site in the console. The redirect carries the same answer
 * the client-side fallback would have reached anyway, silently.
 *
 * Ownership is settled BEFORE anything is fetched, which is the fix for a
 * bug that made external launches unfixable. The resize branch used to
 * self-fetch /i/<ASSET>, silently follow its own 302 out to cdn.xcp.io, and
 * re-serve whatever came back under the one-year shared TTL above. The CDN
 * sends its not-yet-ingested placeholders as `private, max-age=60` precisely
 * because they are provisional; overriding that with a public year turned
 * "the CDN hasn't seen this asset yet" into "this asset has no art until
 * 2027", no matter what its creator fixed afterwards. Two R2 heads settle it
 * instead, and cost less than the worker invocation they replace.
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
 * deliberately omits `w`, so it takes the stored-bytes branch below and cannot
 * recurse. It resizes a mirror as readily as an original, which is the point:
 * we set the size limit on what creators upload here and have no say at all
 * over what a foreign host serves. Zone features do not run on workers.dev,
 * so a failed transform falls through to the stored bytes rather than
 * erroring.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  const normalizedAsset = asset.toUpperCase();
  const encoded = encodeURIComponent(normalizedAsset);
  const search = new URL(request.url).searchParams;
  const requested = search.get("w");
  const width = requested && /^\d{1,4}$/.test(requested) ? Number(requested) : 0;

  const cache = getMetadataEdgeCache();
  const { bucket, ctx } = await getMetadataRuntime();

  // Which bytes are ours to serve, and on whose authority. Asked with heads
  // so the answer costs no body transfer, and asked first so that nothing
  // below can serve somebody else's provisional placeholder as if it were
  // this launch's art.
  const stored = await resolveMetadataArtLocation(
    bucket,
    cache,
    ctx,
    normalizedAsset,
  );
  const cacheControl =
    stored?.kind === "original" ? IMAGE_CACHE_CONTROL : MIRROR_CACHE_CONTROL;

  if (!stored) {
    const fb = search.get("fb") === "full" ? "full" : "icon";
    return new Response(null, {
      status: 302,
      headers: {
        location: `${CDN_BASE}/img/${fb}/${encoded}`,
        // Short-lived: launches upload art before broadcast, so a cached
        // redirect can only ever cover assets that were never ours to serve.
        "cache-control": "public, max-age=300",
      },
    });
  }

  if (width >= 16 && width <= 2048) {
    // `v` is the stored object's etag, and it is load-bearing. Cloudflare keys
    // a transform against the SOURCE url plus the transform options, and
    // `cacheEverything` below is what makes that entry stick — so without a
    // version in the key, a resize is pinned to whatever that url resolved to
    // the first time anyone asked for that width.
    //
    // Which is how EVOLVEDPEPE stayed broken after the fix above shipped.
    // Under the old code this same self-fetch followed its own 302 out to
    // cdn.xcp.io and came back with the 48x48 not-yet-ingested placeholder;
    // that got cached as the w=560 result, and w=560 is what the homepage's
    // large card asks for. The 96px variant, cached at some other moment,
    // was fine. Ownership was being decided correctly and the answer was
    // still wrong, because the answer was never re-fetched.
    //
    // An etag changes on every write, so a replaced original or a mirror
    // advanced to its next stage lands on a key nothing has cached. This
    // route already ignores query parameters it doesn't read, so the inner
    // request still takes the stored-bytes branch and cannot recurse.
    const version = stored.etag ? `?v=${encodeURIComponent(stored.etag)}` : "";
    const source = `${METADATA_ORIGIN}/i/${encoded}${version}`;
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
          "cache-control": cacheControl,
          "access-control-allow-origin": "*",
        },
      });
    }
  }

  // Cache API entries are local to a Cloudflare edge location. Deleting the
  // old `/i/<ASSET>` entry when an owner edited art therefore only fixed the
  // edge that handled the edit; another edge could keep returning the former
  // object for the full shared TTL. The R2 etag changes on every write, making
  // it the immutable part of this otherwise permanent public URL.
  const cacheKey = stored.etag
    ? metadataImageCacheKey(normalizedAsset, stored.etag)
    : null;
  const cached = cacheKey ? await cache?.match(cacheKey) : undefined;
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-metadata-cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const object = await bucket.get(stored.key);
  if (!object) {
    // Deleted between the head and the get. Rare, and the CDN is the same
    // answer the miss above would have given.
    const fb = search.get("fb") === "full" ? "full" : "icon";
    return new Response(null, {
      status: 302,
      headers: {
        location: `${CDN_BASE}/img/${fb}/${encoded}`,
        "cache-control": "public, max-age=300",
      },
    });
  }
  const response = new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": cacheControl,
      "access-control-allow-origin": "*",
      "x-metadata-cache": "MISS",
    },
  });
  // If a provider ever omits the etag, serve from R2 without shared caching;
  // falling back to an unversioned key would recreate the stale-art bug.
  if (cache && cacheKey) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
  }
  return response;
}
