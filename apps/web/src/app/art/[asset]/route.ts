import { getMetadataBucket } from "@/lib/metadata";
import { CDN_BASE } from "@/lib/constants";

/**
 * Resolves a launch's hero art wherever it actually lives: cdn.xcp.io if
 * it's real, our own hosted original if the CDN hasn't ingested it yet.
 * cdn.xcp.io serves 200 image/png with `x-cdn-placeholder: 1` for anything
 * it hasn't crawled — not a 404 — and that header isn't in the CORS-exposed
 * safelist, so a browser can never read it on a cross-origin fetch to
 * cdn.xcp.io. Checked here, server-side, where CORS doesn't apply.
 *
 * The fallback reads R2 directly (like /i/[asset]/route.ts) rather than
 * self-fetching /i/<ASSET> over HTTP — a Worker fetching its own zone comes
 * back non-OK here even though the same URL is fine from the outside.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset: rawAsset } = await params;
  const asset = rawAsset.toUpperCase();

  try {
    const cdn = await fetch(`${CDN_BASE}/img/full/${asset}`);
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
    // cdn.xcp.io unreachable — fall through to our own hosted original
  }

  const bucket = await getMetadataBucket();
  const object = await bucket.get(`i/${asset}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
