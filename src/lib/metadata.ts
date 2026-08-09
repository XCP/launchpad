import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The canonical, permanent URLs baked into on-chain descriptions. The
 * description field locks at launch close, so these must be stable forever —
 * they are the production domain regardless of where the app runs today.
 */
export const METADATA_ORIGIN = "https://xcp.fun";
export const metadataJsonUrl = (asset: string) => `${METADATA_ORIGIN}/${asset}.json`;
export const metadataImageUrl = (asset: string) => `${METADATA_ORIGIN}/full/${asset}`;

/**
 * True 48x48 icon at a clean permanent URL; the /icon route performs the
 * Cloudflare image transformation internally. Resized bytes differ from
 * the original, so this entry carries no content hash.
 */
export const metadataIconUrl = (asset: string) =>
  `${METADATA_ORIGIN}/icon/${asset}`;

/** Minimal structural R2 types — avoids a workers-types dependency. */
interface R2Object {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}
export interface R2Bucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export async function getMetadataBucket(): Promise<R2Bucket> {
  const { env } = await getCloudflareContext({ async: true });
  const bucket = (env as Record<string, unknown>).METADATA as R2Bucket | undefined;
  if (!bucket) throw new Error("METADATA R2 binding not available");
  return bucket;
}
