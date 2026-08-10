import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { big, parseJsonLossless, type Raw } from "@/lib/numeric";
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
  // Not res.json(): JSON.parse rounds integers above 2^53-1; oversized
  // integers arrive as strings instead.
  return parseJsonLossless<T>(await res.text());
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
  earn_quantity: Raw;
  paid_quantity: Raw;
  commission: Raw;
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
  reserve_a: Raw;
  reserve_b: Raw;
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
  reserve_a: Raw;
  reserve_b: Raw;
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
  return (await fetchOriginalRecord(txHash)).deadline;
}

/**
 * The fairminter as it was created. The `/fairminters` row mutates —
 * `block_index` is rewritten to the block the launch OPENS in, and a closed
 * row's `soft_cap_deadline_block` becomes the settlement block — so neither
 * field can answer a question about creation. The NEW_FAIRMINTER event is
 * append-only and can: its own block_index is the block the announcement
 * confirmed in, which is what pre-announcement has to be measured against.
 */
export async function fetchOriginalRecord(
  txHash: string,
): Promise<{ deadline: number | null; announceBlock: number | null }> {
  const data = await get<{
    result: {
      block_index: number;
      params: { soft_cap_deadline_block: number };
    }[];
    // Append-only: a launch's creation event never changes, so this is
    // asked once per launch rather than once an hour per launch.
  }>(`/transactions/${txHash}/events/NEW_FAIRMINTER`, 31_536_000);
  const event = data.result?.[0];
  return {
    deadline: event?.params?.soft_cap_deadline_block ?? null,
    announceBlock: event?.block_index ?? null,
  };
}

/**
 * Open XCP dispensers, cheapest first. Non-oracle only (oracle dispensers
 * price via an external feed, so the BTC trigger amount can't be computed
 * safely client-side) and single-unit only (give_quantity of exactly 1 XCP)
 * so quantities read one-XCP-at-a-time and the presets land exactly.
 * `price` is the API's computed sats per whole XCP.
 *
 * Plain numbers, unlike the fairminter and pool records: every field here is
 * bounded by XCP's own supply (~2.6M, so 2.6e14 raw) or by a Bitcoin sat
 * amount, both an order of magnitude clear of 2^53. Nothing arrives as a
 * string, so nothing needs the exact path.
 */
export interface Dispenser {
  tx_hash: string;
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

interface PoolMatch {
  status: string;
  forward_asset: string;
  forward_quantity: Raw;
  backward_asset: string;
  backward_quantity: Raw;
  block_time: number;
}

export interface PoolVolume {
  /** Stringified bigint — crosses the server/client prop boundary like
   *  every other raw quantity in this codebase; convert with big(). */
  volumeXcpRaw: Raw;
  trades: number;
}

/**
 * Trailing 24h swap volume + trade count for the TOKEN/XCP pool, computed
 * from the pool's own match history rather than a third-party aggregate —
 * matches page newest-first, so this stops as soon as it walks outside the
 * window instead of always paging to `maxPages`.
 */
export async function fetchPoolVolume24h(
  asset: string,
  maxPages = 3,
): Promise<PoolVolume> {
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;
  let volumeXcpRaw = 0n;
  let trades = 0;
  let cursor: number | null = null;
  let pages = 0;
  let inWindow = true;
  do {
    const page: Paginated<PoolMatch> = await get(
      `/pools/${encodeURIComponent(asset)}/XCP/matches?limit=200${
        cursor !== null ? `&cursor=${cursor}` : ""
      }`,
      30,
    );
    for (const m of page.result) {
      if (m.block_time < cutoff) {
        inWindow = false;
        break;
      }
      if (m.status !== "valid") continue;
      volumeXcpRaw += big(
        m.forward_asset === "XCP" ? m.forward_quantity : m.backward_quantity,
      );
      trades++;
    }
    cursor = page.next_cursor;
    pages++;
  } while (inWindow && cursor !== null && pages < maxPages);
  return { volumeXcpRaw: volumeXcpRaw.toString(), trades };
}

export async function fetchBlockHeight(): Promise<number> {
  const data = await get<{ result: { counterparty_height: number } }>("/", 30);
  return data.result.counterparty_height;
}
