import {
  METADATA_ORIGIN,
  getMetadataEdgeCache,
  getMetadataRuntime,
  resolveMetadataArtLocation,
} from "@/lib/metadata";

/**
 * Clean permanent URL for the 48x48 icon: /icon/<ASSET>. Performs the
 * Cloudflare image transformation via the fetch `cf.image` option instead
 * of exposing the /cdn-cgi/image/ syntax in on-chain metadata. Falls back
 * to the original image if transformation is unavailable (e.g. workers.dev,
 * where zone features don't run).
 *
 * This URL is written into the enhanced-asset-info JSON of every launch
 * created here (metadataIconUrl), which is what makes both checks below
 * matter more than they would on a page:
 *
 *  - Nothing is fetched until R2 confirms we hold the asset. Without that,
 *    an asset we host nothing for followed /i's redirect out to cdn.xcp.io
 *    and served its not-yet-ingested grey placeholder as the launch's
 *    canonical icon, for an hour at a time.
 *  - The source carries the stored object's etag. Cloudflare files a
 *    transform under the url it fetched, and `cacheEverything` below makes
 *    that entry stick — so an unversioned source pins this icon to whatever
 *    the picture was the first time anyone asked, and replacing the art
 *    through the edit panel could never dislodge it. See the longer note in
 *    /i/[asset]/route.ts, where the same omission served a placeholder at
 *    one width and the real art at another.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  const normalizedAsset = asset.toUpperCase();
  const cache = getMetadataEdgeCache();
  const { bucket, ctx } = await getMetadataRuntime();
  const stored = await resolveMetadataArtLocation(
    bucket,
    cache,
    ctx,
    normalizedAsset,
  );
  // A 404 rather than the CDN's guess: this is the icon an on-chain
  // description's metadata points at, and no icon is a better answer there
  // than a placeholder that looks like one.
  if (!stored) return new Response("Not found", { status: 404 });

  const version = stored.etag ? `?v=${encodeURIComponent(stored.etag)}` : "";
  const source = `${METADATA_ORIGIN}/i/${encodeURIComponent(normalizedAsset)}${version}`;
  // Deadlines on both: this is a server-side proxy, so a stalled upstream
  // holds the Worker invocation open, and the untransformed retry below is
  // unreachable if the first request never settles -- which is exactly the
  // case the retry exists for.
  const init = {
    cf: {
      image: { format: "auto", fit: "cover", width: 48, height: 48 },
      cacheEverything: true,
    },
    signal: AbortSignal.timeout(6_000),
  } as RequestInit;
  let res = await fetch(source, init).catch(() => new Response(null, { status: 504 }));
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
    res = await fetch(source, { signal: AbortSignal.timeout(6_000) })
      .catch(() => new Response(null, { status: 504 }));
  }
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      // A mirror is a copy of a file its owner can change; an original is
      // ours and replaced only through the editor. Same split as /i.
      "cache-control": stored.kind === "original" ? "public, max-age=3600" : "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
