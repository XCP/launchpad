import { getMetadataBucket } from "@/lib/metadata";

/** Serves the enhanced-asset-info JSON referenced by on-chain descriptions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const asset = file.replace(/\.json$/i, "").toUpperCase();
  const bucket = await getMetadataBucket();
  const object = await bucket.get(`j/${asset}`);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
