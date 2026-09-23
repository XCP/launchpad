import { classifyDescription, proseDescription } from "@launchpad/xcp69/description";
import { boundedJson } from "@/lib/bounded-body";
import { XCP_API_BASE } from "@/lib/constants";
import { METADATA_ORIGIN } from "@/lib/metadata";
import { discard } from "@/lib/net";

const MAX_METADATA_BYTES = 512 * 1024;
const MAX_DESCRIPTION_CHARS = 2_000;

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
    const response = await fetch(
      hosted ? url.href : `${XCP_API_BASE}/assets/${encodeURIComponent(asset)}/enhanced`,
      { signal: AbortSignal.timeout(5_000), next: { revalidate: 300 }, redirect: "error" },
    );
    if (!response.ok) {
      await discard(response);
      return null;
    }
    const body = record(await boundedJson(response, MAX_METADATA_BYTES));
    const result = record(body?.result);
    // The explorer resolves the asset's current pointer. Do not borrow the
    // description from a different issuance or metadata document.
    if (!hosted && (result?.error || result?.url !== pointer)) return null;
    const metadata = hosted ? body : record(result?.json);
    if (!metadata || typeof metadata.description !== "string") return null;
    // Our hosted legacy documents may omit asset; external enhanced-info
    // must identify this asset rather than merely being arbitrary JSON.
    if ((!hosted || metadata.asset !== undefined) &&
        (typeof metadata.asset !== "string" || metadata.asset.toUpperCase() !== asset.toUpperCase())) return null;
    return metadata.description.trim().slice(0, MAX_DESCRIPTION_CHARS) || null;
  } catch {
    return null;
  }
}
