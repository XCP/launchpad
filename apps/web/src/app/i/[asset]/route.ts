import { getMetadataBucket } from "@/lib/metadata";
import { CDN_BASE } from "@/lib/constants";

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
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  const bucket = await getMetadataBucket();
  const object = await bucket.get(`i/${asset.toUpperCase()}`);
  if (!object) {
    const fb = new URL(request.url).searchParams.get("fb") === "full" ? "full" : "icon";
    return new Response(null, {
      status: 302,
      headers: {
        location: `${CDN_BASE}/img/${fb}/${encodeURIComponent(asset.toUpperCase())}`,
        // Short-lived: launches upload art before broadcast, so a cached
        // redirect can only ever cover assets that were never ours to serve.
        "cache-control": "public, max-age=300",
      },
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
