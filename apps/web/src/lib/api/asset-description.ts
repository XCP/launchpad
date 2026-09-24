import { classifyDescription, proseDescription } from "@launchpad/xcp69/description";
import { boundedJson } from "@/lib/bounded-body";
import { XCP_API_BASE } from "@/lib/constants";
import { getMetadataBucket, METADATA_ORIGIN } from "@/lib/metadata";
import { discard } from "@/lib/net";

const MAX_METADATA_BYTES = 512 * 1024;
const MAX_DESCRIPTION_CHARS = 2_000;

/** The R2 key behind one of our own pointers, `/<ASSET>.json` or its
 * `/j/<ASSET>.json` form, when it names this asset. */
function hostedKey(url: URL, asset: string): string | null {
  const match = /^\/(?:j\/)?([A-Za-z0-9]+)\.json$/.exec(url.pathname);
  if (!match || match[1].toUpperCase() !== asset.toUpperCase() || url.search) return null;
  return `j/${asset.toUpperCase()}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Server-side only: foreign JSON comes through the explorer's existing
 * enhanced-info reader, never a new arbitrary-URL proxy or browser fetch.
 * Curated words win; failed reads leave the page's existing fallback intact. */
export async function fetchAssetDescription(
  asset: string,
  description: string | null | undefined,
  mimeType: string | null | undefined,
  curated: string | null,
): Promise<string | null> {
  if (curated?.trim()) return curated.trim();
  if (classifyDescription(description, mimeType) !== "url") {
    return proseDescription(description, mimeType, asset) || null;
  }

  try {
    const pointer = (description ?? "").trim();
    const url = new URL(pointer);
    if (url.username || url.password) return null;
    const hosted = url.origin === METADATA_ORIGIN;
    // Our own documents are read from the bucket. Over HTTP this Worker
    // would be fetching its own zone, and Cloudflare does not route that
    // subrequest back through the Worker, so every hosted launch showed
    // its bare JSON link instead of its words.
    if (hosted) {
      const key = hostedKey(url, asset);
      const object = key ? await (await getMetadataBucket()).get(key) : null;
      if (!object) return null;
      const metadata = record(await boundedJson(new Response(object.body), MAX_METADATA_BYTES));
      if (typeof metadata?.description !== "string") return null;
      if (metadata.asset !== undefined &&
          (typeof metadata.asset !== "string" || metadata.asset.toUpperCase() !== asset.toUpperCase())) return null;
      return metadata.description.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
    }
    const response = await fetch(
      `${XCP_API_BASE}/assets/${encodeURIComponent(asset)}/enhanced`,
      // Workers supports manual/follow, but rejects redirect: "error".
      // Manual leaves redirects non-OK so they take the link fallback below.
      { signal: AbortSignal.timeout(5_000), next: { revalidate: 300 }, redirect: "manual" },
    );
    if (!response.ok) {
      await discard(response);
      return null;
    }
    const body = record(await boundedJson(response, MAX_METADATA_BYTES));
    const result = record(body?.result);
    // The explorer resolves the asset's current pointer. Do not borrow the
    // description from a different issuance or metadata document.
    if (result?.error || result?.url !== pointer) return null;
    const metadata = record(result?.json);
    if (!metadata || typeof metadata.description !== "string") return null;
    // External enhanced-info must identify this asset rather than merely
    // being arbitrary JSON. Our hosted legacy documents may omit it (above).
    if (typeof metadata.asset !== "string" || metadata.asset.toUpperCase() !== asset.toUpperCase()) return null;
    return metadata.description.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
  } catch {
    return null;
  }
}
