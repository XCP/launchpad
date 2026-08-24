import { getMetadataBucket } from "@/lib/metadata";
import { CDN_BASE } from "@/lib/constants";

/**
 * Resolves a launch's hero art wherever it actually lives: our mirror if we
 * deliberately placed one, cdn.xcp.io if it's real, our own hosted original
 * if the CDN hasn't ingested it yet. cdn.xcp.io serves 200 image/png with
 * `x-cdn-placeholder: 1` for anything it hasn't crawled — not a 404 — and
 * that header isn't in the CORS-exposed safelist, so a browser can never read
 * it on a cross-origin fetch to cdn.xcp.io. Checked here, server-side, where
 * CORS doesn't apply.
 *
 * `m/<ASSET>` outranks the CDN because it is the one copy here that somebody
 * chose to keep current — see the mirror note in /i/[asset]/route.ts. The CDN
 * ingests an asset once; a mirror exists precisely for launches where once
 * was not enough.
 *
 * Both R2 reads go through the bucket directly (like /i/[asset]/route.ts)
 * rather than self-fetching /i/<ASSET> over HTTP — a Worker fetching its own
 * zone comes back non-OK here even though the same URL is fine from outside.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset: rawAsset } = await params;
  const asset = rawAsset.toUpperCase();
  const bucket = await getMetadataBucket();

  const mirror = await bucket.get(`m/${asset}`);
  if (mirror) {
    return new Response(mirror.body, {
      headers: {
        "content-type": mirror.httpMetadata?.contentType ?? "image/png",
        // Somebody else's picture, kept fresh by a job rather than owned
        // here — five minutes, matching /i.
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    });
  }

  try {
    // Server-side proxy: a stalled CDN holds this Worker invocation open, and
    // the catch that falls back to our own copy only runs on a settled failure.
    const cdn = await fetch(`${CDN_BASE}/img/full/${asset}`, {
      signal: AbortSignal.timeout(6_000),
    });
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
