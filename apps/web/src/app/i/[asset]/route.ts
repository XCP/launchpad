import { getMetadataBucket } from "@/lib/metadata";

/** Serves a launch's uploaded token image. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const { asset } = await params;
  const bucket = await getMetadataBucket();
  const object = await bucket.get(`i/${asset.toUpperCase()}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  });
}
