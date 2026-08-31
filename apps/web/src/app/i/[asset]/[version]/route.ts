import { getMetadataRuntime } from "@/lib/metadata";

/**
 * Immutable source used only by Cloudflare Image transformations.
 *
 * The public `/i/<ASSET>` URL is permanent and replaceable. This source puts
 * the R2 etag in the pathname, so a replacement can never collide with a
 * transform or fetch cache created for the previous object.
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
