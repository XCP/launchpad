import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import type { Fairminter } from "@/lib/xcp69";

interface Paginated<T> {
  result: T[];
  next_cursor: number | null;
  result_count: number;
}

async function get<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(`${COUNTERPARTY_API_BASE}${path}`, {
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`Counterparty API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

/**
 * All fairminters, following next_cursor to the end (the old site's hardcoded
 * limit=200 silently dropped a third of the records). The XCP-69 universe is
 * small; pages are cached per-URL by Next's fetch cache.
 */
export async function fetchAllFairminters(revalidate = 60): Promise<Fairminter[]> {
  const all: Fairminter[] = [];
  let cursor: number | null = null;
  do {
    const page: Paginated<Fairminter> = await get(
      `/fairminters?limit=1000&verbose=true${cursor !== null ? `&cursor=${cursor}` : ""}`,
      revalidate,
    );
    all.push(...page.result);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return all;
}

/** Fairminters opened on an asset; the XCP-69 one (if any) is what we show. */
export async function fetchFairmintersByAsset(asset: string): Promise<Fairminter[]> {
  const data = await get<Paginated<Fairminter>>(
    `/assets/${encodeURIComponent(asset)}/fairminters?limit=100&verbose=true`,
    30,
  );
  return data.result;
}

export async function fetchFairminter(txHash: string): Promise<Fairminter | null> {
  const data = await get<{ result: Fairminter | null }>(
    `/fairminters/${txHash}?verbose=true`,
    30,
  );
  return data.result ?? null;
}

export interface Fairmint {
  tx_hash: string;
  block_index: number;
  source: string;
  fairminter_tx_hash: string;
  asset: string;
  earn_quantity: number;
  paid_quantity: number;
  commission: number;
  status: string;
}

export async function fetchFairmints(
  fairminterTxHash: string,
  limit = 1000,
): Promise<Fairmint[]> {
  const data = await get<Paginated<Fairmint>>(
    `/fairminters/${fairminterTxHash}/fairmints?limit=${limit}&verbose=true`,
    30,
  );
  return data.result;
}

export interface Pool {
  asset_a: string;
  asset_b: string;
  reserve_a: number;
  reserve_b: number;
  lp_asset: string;
  reserve_a_normalized?: string;
  reserve_b_normalized?: string;
}

/** TOKEN/XCP pool for an asset, or null — the launched-vs-refunded oracle. */
export async function fetchPool(asset: string): Promise<Pool | null> {
  try {
    const data = await get<{ result: Pool | null }>(
      `/pools/${encodeURIComponent(asset)}/XCP?verbose=true`,
      60,
    );
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function fetchBlockHeight(): Promise<number> {
  const data = await get<{ result: { counterparty_height: number } }>("/", 30);
  return data.result.counterparty_height;
}
