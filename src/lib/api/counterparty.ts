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

/**
 * Reserve snapshots for the TOKEN/XCP pair, one row per pool state change
 * (deposits, withdrawals, and every swap). Ascending by tx_index after the
 * client-side reverse; price = reserve ratio at each point.
 */
export interface PoolSnapshot {
  block_index: number;
  tx_index: number;
  asset_a: string;
  asset_b: string;
  reserve_a: number;
  reserve_b: number;
}

export async function fetchPoolPriceHistory(
  asset: string,
  maxPages = 5,
): Promise<PoolSnapshot[]> {
  const rows: PoolSnapshot[] = [];
  let cursor: number | null = null;
  let pages = 0;
  do {
    const page: Paginated<PoolSnapshot> = await get(
      `/pools/${encodeURIComponent(asset)}/XCP/price_history?limit=1000${
        cursor !== null ? `&cursor=${cursor}` : ""
      }`,
      30,
    );
    rows.push(...page.result);
    cursor = page.next_cursor;
    pages++;
  } while (cursor !== null && pages < maxPages);
  return rows.reverse();
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

/**
 * The composed soft_cap_deadline_block from the immutable NEW_FAIRMINTER
 * event. The fairminters row is REWRITTEN on an early sell-out (core pulls
 * the deadline forward to the fill block), so for closed launches only the
 * event history preserves the original window. Closed records never change —
 * cache long.
 */
export async function fetchOriginalDeadline(txHash: string): Promise<number | null> {
  const data = await get<{
    result: { params: { soft_cap_deadline_block: number } }[];
  }>(`/transactions/${txHash}/events/NEW_FAIRMINTER`, 3600);
  return data.result?.[0]?.params?.soft_cap_deadline_block ?? null;
}

/**
 * Open XCP dispensers, cheapest first. Non-oracle only (oracle dispensers
 * price via an external feed, so the BTC trigger amount can't be computed
 * safely client-side) and single-unit only (give_quantity of exactly 1 XCP)
 * so quantities read one-XCP-at-a-time and the presets land exactly.
 * `price` is the API's computed sats per whole XCP.
 */
export interface Dispenser {
  source: string;
  give_quantity: number;
  give_remaining: number;
  satoshirate: number;
  price: number;
}

export async function fetchXcpDispensers(limit = 10): Promise<Dispenser[]> {
  const data = await get<Paginated<Dispenser>>(
    `/assets/XCP/dispensers?status=open&exclude_with_oracle=true&sort=price:asc&limit=100`,
    60,
  );
  return data.result
    .filter((d) => d.give_remaining > 0 && d.give_quantity === 1e8)
    .slice(0, limit);
}

export async function fetchBlockHeight(): Promise<number> {
  const data = await get<{ result: { counterparty_height: number } }>("/", 30);
  return data.result.counterparty_height;
}
