import { getMetadataRuntime } from "@/lib/metadata";

/**
 * Immutable source used only by Cloudflare Image transformations.
 *
 * This intentionally does not live below `/i/*`. Older deployments and a
 * zone-side metadata proxy cached that namespace before image replacement was
 * supported. A separate namespace prevents those legacy rules from collapsing
 * this path-versioned object back into `/i/<ASSET>`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string; version: string }> },
) {
  const { asset, version } = await params;
  const normalizedAsset = asset.toUpperCase();
  const requestedVersion = decodeURIComponent(version);
  const { bucket } = await getMetadataRuntime();

  const originalKey = `i/${normalizedAsset}`;
  const original = await bucket.head(originalKey);
  const mirrorKey = `m/${normalizedAsset}`;
  const mirror = original ? null : await bucket.head(mirrorKey);
  const stored = original ?? mirror;
  const key = original ? originalKey : mirror ? mirrorKey : null;

  if (!stored?.etag || stored.etag !== requestedVersion || !key) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  const object = await bucket.get(key);
  if (!object) {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  });
}
