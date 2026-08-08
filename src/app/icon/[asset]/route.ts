import { metadataImageUrl } from "@/lib/metadata";

/**
 * Clean permanent URL for the 48x48 icon: /icon/<ASSET>. Performs the
 * Cloudflare image transformation via the fetch `cf.image` option instead
 * of exposing the /cdn-cgi/image/ syntax in on-chain metadata. Falls back
 * to the original image if transformation is unavailable (e.g. workers.dev,
 * where zone features don't run).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  const source = metadataImageUrl(asset.toUpperCase());
  const init = {
    cf: {
      image: { format: "auto", fit: "cover", width: 48, height: 48 },
      cacheEverything: true,
    },
  } as RequestInit;
  let res = await fetch(source, init);
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
    res = await fetch(source);
  }
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/png",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
