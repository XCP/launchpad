import {
  getMetadataEdgeCache,
  getMetadataRuntime,
  metadataCacheKey,
} from "@/lib/metadata";

/** Serves the enhanced-asset-info JSON referenced by on-chain descriptions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const asset = file.replace(/\.json$/i, "").toUpperCase();
  const cache = getMetadataEdgeCache();
  const cacheKey = metadataCacheKey(`/j/${encodeURIComponent(asset)}.json`);
  const cached = await cache?.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set("x-metadata-cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers });
  }

  const { bucket, ctx } = await getMetadataRuntime();
  const object = await bucket.get(`j/${asset}`);
  if (!object) return new Response("Not found", { status: 404 });
  const response = new Response(object.body, {
    headers: {
      "content-type": "application/json",
      // Shared caches keep it for a year and the editor evicts them on write
      // (purgeMetadataCache); browsers get a minute. It used to be
      // `immutable`, which is a promise this file cannot keep — the owner
      // can rewrite it from the edit panel, and `immutable` tells the
      // browser not to revalidate even on a reload, so the person who just
      // saved was the one guaranteed to keep seeing the old copy.
      "cache-control": "public, max-age=60, s-maxage=31536000",
      "access-control-allow-origin": "*",
      "x-metadata-cache": "MISS",
    },
  });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
  return response;
}
