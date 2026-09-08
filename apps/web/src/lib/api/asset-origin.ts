import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { discard } from "@/lib/net";
import { parseJsonLossless } from "@/lib/numeric";

export type AssetOrigin = { kind: "new" } | { kind: "existing"; year: number };

interface OriginIssuance {
  asset?: unknown;
  tx_hash?: unknown;
  tx_index?: unknown;
  msg_index?: unknown;
  block_index?: unknown;
  block_time?: unknown;
  asset_events?: unknown;
  status?: unknown;
}

const PAGE_SIZE = 10;
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * The first valid issuance identifies the asset's origin, independently of
 * the mutable fairminter row. A reused name keeps its original UTC year;
 * only an opening issuance from this fairminter makes this a new asset.
 *
 * Core supports sorting issuances by block, but not by transaction index.
 * Read a small first-block sample and order its ties locally. If that block
 * has more issuances than the sample can prove, omit the claim.
 */
export async function fetchAssetOrigin(
  asset: string,
  fairminterTxHash: string,
): Promise<AssetOrigin | null> {
  try {
    const response = await fetch(
      `${COUNTERPARTY_API_BASE}/assets/${encodeURIComponent(asset)}/issuances?limit=${PAGE_SIZE}&verbose=true&sort=block_index:asc`,
      { signal: AbortSignal.timeout(5_000), next: { revalidate: 300 } },
    );
    if (!response.ok) {
      await discard(response);
      return null;
    }
    const body = parseJsonLossless(await response.text()) as {
      result?: OriginIssuance[];
      result_count?: unknown;
    };
    const rows = body.result;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    if (rows.some((row) =>
      row.asset !== asset || row.status !== "valid" ||
      !integer(row.block_index) || !integer(row.tx_index) ||
      !integer(row.msg_index) || typeof row.tx_hash !== "string"
    )) return null;

    const ordered = [...rows].sort((a, b) =>
      (a.block_index as number) - (b.block_index as number) ||
      (a.tx_index as number) - (b.tx_index as number) ||
      (a.msg_index as number) - (b.msg_index as number),
    );
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const complete = integer(body.result_count) && body.result_count === rows.length;
    if (!complete && first.block_index === last.block_index) return null;

    const events = typeof first.asset_events === "string"
      ? first.asset_events.split(",").map((event) => event.trim())
      : [];
    if (first.tx_hash === fairminterTxHash && events.includes("open_fairminter")) {
      return { kind: "new" };
    }
    if (!integer(first.block_time) || first.block_time === 0) return null;
    const year = new Date(first.block_time * 1_000).getUTCFullYear();
    if (!Number.isInteger(year) || year < 2014 || year > new Date().getUTCFullYear() + 1) return null;
    return { kind: "existing", year };
  } catch {
    // An unavailable or not-yet-indexed origin is not evidence of a new name.
    return null;
  }
}
