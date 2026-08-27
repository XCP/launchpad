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
interface R2ObjectMeta {
  /** Changes on every write. What /i/[asset] versions its resize source
   *  with, so a replaced picture cannot be served from a transform cached
   *  against the old one. */
  etag?: string;
  httpMetadata?: { contentType?: string };
}
interface R2Object extends R2ObjectMeta {
  body: ReadableStream;
}
export interface R2Bucket {
  head(key: string): Promise<R2ObjectMeta | null>;
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ArrayBuffer | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export interface MetadataArtLocation {
  kind: "original" | "mirror";
  key: string;
  etag?: string;
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

const ART_LOCATION_TTL = 300;
const ART_LOCATION_KIND = "x-metadata-art-kind";
const ART_LOCATION_ETAG = "x-metadata-art-etag";

export function metadataArtLocationCacheKey(asset: string): Request {
  return metadataCacheKey(`/_art-location/${encodeURIComponent(asset.toUpperCase())}`);
}

/**
 * Resolve whether launch art is our original, a mirrored copy, or absent.
 *
 * Asset chips and Telegram previews ask for the same missing assets repeatedly.
 * Without this short edge entry each request performs one or two R2 HEADs just
 * to rediscover the same answer. Five minutes matches the existing redirect
 * and mirror TTLs, while owner edits explicitly evict this key below.
 */
export async function resolveMetadataArtLocation(
  bucket: R2Bucket,
  cache: Cache | null,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  asset: string,
): Promise<MetadataArtLocation | null> {
  const normalized = asset.toUpperCase();
  const cacheKey = metadataArtLocationCacheKey(normalized);
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) {
    const kind = cached.headers.get(ART_LOCATION_KIND);
    if (kind === "none") return null;
    if (kind === "original" || kind === "mirror") {
      const etag = cached.headers.get(ART_LOCATION_ETAG) ?? undefined;
      return {
        kind,
        key: `${kind === "original" ? "i" : "m"}/${normalized}`,
        ...(etag ? { etag } : {}),
      };
    }
  }

  const original = await bucket.head(`i/${normalized}`);
  const mirror = original ? null : await bucket.head(`m/${normalized}`);
  const stored = original ?? mirror;
  const kind = original ? "original" : mirror ? "mirror" : "none";
  if (cache) {
    const headers = new Headers({
      "cache-control": `public, max-age=${ART_LOCATION_TTL}`,
      [ART_LOCATION_KIND]: kind,
    });
    if (stored?.etag) headers.set(ART_LOCATION_ETAG, stored.etag);
    ctx.waitUntil(
      cache
        .put(cacheKey, new Response(null, { headers }))
        .catch(() => undefined),
    );
  }
  if (!stored || kind === "none") return null;
  return {
    kind,
    key: `${kind === "original" ? "i" : "m"}/${normalized}`,
    ...(stored.etag ? { etag: stored.etag } : {}),
  };
}

/**
 * Evict the edge-cached copies of a launch's metadata after an owner edits
 * it. Without this, "Saved. Cached pages may take a minute to refresh" was a
 * promise the cache never kept: the JSON and the image are served with a
 * one-year shared TTL on the assumption that they are written once, and the
 * editor is the one path that makes that false. Pass the same pathnames the
 * serving routes build their keys from.
 *
 * Best-effort by design — a failed delete leaves a stale edge entry that
 * expires on its own, which is not worth failing a completed write over.
 */
export async function purgeMetadataCache(pathnames: string[]): Promise<void> {
  const cache = getMetadataEdgeCache();
  if (!cache) return;
  const keys = pathnames.flatMap((pathname) => {
    const art = pathname.match(/^\/i\/([^/?]+)/);
    return art?.[1]
      ? [
          metadataCacheKey(pathname),
          metadataArtLocationCacheKey(decodeURIComponent(art[1])),
        ]
      : [metadataCacheKey(pathname)];
  });
  await Promise.all(
    keys.map((key) =>
      cache.delete(key).catch(() => false),
    ),
  );
}
