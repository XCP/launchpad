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
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
      "x-metadata-cache": "MISS",
    },
  });
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
  return response;
}
