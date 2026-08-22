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

interface DescriptionDbStatement {
  bind(...values: unknown[]): DescriptionDbStatement;
  run(): Promise<unknown>;
}

interface DescriptionDb {
  prepare(query: string): DescriptionDbStatement;
}

export async function getMetadataRuntime() {
  const { env, ctx } = await getCloudflareContext({ async: true });
  const bucket = (env as Record<string, unknown>).METADATA as R2Bucket | undefined;
  if (!bucket) throw new Error("METADATA R2 binding not available");
  return { bucket, ctx };
}

export async function getMetadataBucket(): Promise<R2Bucket> {
  return (await getMetadataRuntime()).bucket;
}

/** Keep D1's display copy in step with an owner-authorized metadata edit.
 *  Creation is intentionally not mirrored here: the fairminter row does not
 *  exist yet, so the API indexer's one-time worklist picks it up after the
 *  transaction appears on-chain. */
export async function updateIndexedDescription(asset: string, description: string): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as Record<string, unknown>).DB as DescriptionDb | undefined;
  if (!db) return;
  const prose = description.replace(/\s+/g, " ").trim().slice(0, 2_000);
  await db
    .prepare(
      `UPDATE launches SET display_description = ?1
        WHERE asset = ?2 AND display_description IS NOT ?1`,
    )
    .bind(prose, asset)
    .run();
}

type CloudflareCacheStorage = CacheStorage & { default?: Cache };
const METADATA_CACHE_ORIGIN = "https://launchpad.me-bbe.workers.dev";

export function getMetadataEdgeCache(): Cache | null {
  const runtime = globalThis as typeof globalThis & { caches?: CloudflareCacheStorage };
  return runtime.caches?.default ?? null;
}

export function metadataCacheKey(pathname: string): Request {
  return new Request(`${METADATA_CACHE_ORIGIN}${pathname}`, { method: "GET" });
}
