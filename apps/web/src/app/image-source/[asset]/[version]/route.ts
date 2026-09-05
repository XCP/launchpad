import {
  getMetadataEdgeCache,
  getMetadataRuntime,
  readVersionedImage,
} from "@/lib/metadata";

/**
 * Immutable source used only by Cloudflare Image transformations.
 *
 * Cloudflare caches a transform against the URL it fetched, and `/i`'s resize
 * branch asks with `cacheEverything`, so the source URL has to name one exact
 * object version. The etag is in the path: two versions can never share an
 * entry, and an owner's edit lands on a URL nothing has cached yet.
 *
 * Bytes are reused across requests by that same identity. A transform cache
 * miss at any edge used to cost a HEAD and a GET here every time — twenty
 * identical requests were twenty of each — and the pair could straddle an
 * edit and answer an old version's URL with the replacement's body. The
 * shared read validates the version against the object it returns instead.
 *
 * An owner's original is asked for before a mirror, as everywhere else
 * ownership is resolved. An original that exists at another version still
 * wins, so a matching mirror can never stand in for it; only a genuinely
 * absent original lets the mirror answer.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string; version: string }> },
) {
  const { asset, version } = await params;
  const normalizedAsset = asset.toUpperCase();
  const requestedVersion = decodeURIComponent(version);
  const cache = getMetadataEdgeCache();
  const { bucket, ctx } = await getMetadataRuntime();

  const image = await readVersionedImage(
    bucket,
    cache,
    ctx,
    normalizedAsset,
    requestedVersion,
    [`i/${normalizedAsset}`, `m/${normalizedAsset}`],
  );
  if (!image) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  return new Response(image.body, {
    headers: {
      "content-type": image.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
      "x-metadata-cache": image.cacheStatus,
    },
  });
}
