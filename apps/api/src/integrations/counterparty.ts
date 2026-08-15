/**
 * The only module in this worker allowed to call the Counterparty API. The
 * poller reads through here; every read route answers from D1.
 */
import { parseJsonLossless } from "@launchpad/xcp69/numeric";
import type { MempoolMint } from "@launchpad/xcp69/mempool";

const BASE = "https://api.counterparty.io:4000/v2";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Counterparty ${path} -> HTTP ${res.status}`);
  // Native res.json() rounds integers past 2^53 — exactly what XCP-69's 1e16
  // hard cap sits above. Parse losslessly so unsafe magnitudes survive as
  // strings instead of silently drifting, the same way the web app does.
  return parseJsonLossless<T>(await res.text());
}

export interface CpFairminter {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  source: string;
  asset: string;
  asset_longname: string | null;
  description: string;
  price: number | string;
  quantity_by_price: number | string;
  hard_cap: number | string;
  soft_cap: number | string;
  soft_cap_deadline_block: number;
  start_block: number;
  end_block: number;
  burn_payment: boolean;
  max_mint_per_tx: number | string;
  max_mint_per_address: number | string | null;
  premint_quantity: number | string;
  minted_asset_commission_int: number | string | null;
  lock_description: boolean;
  lock_quantity: boolean;
  divisible: boolean;
  pool_quantity: number | string | null;
  lp_asset: string | null;
  status: string;
  earned_quantity: number | string | null;
  paid_quantity: number | string | null;
}

/** Every fairminter on the chain, paginated to exhaustion — never a fixed
 *  page count, per the project's standing rule on Counterparty pagination. */
export async function fetchAllFairminters(): Promise<CpFairminter[]> {
  const rows: CpFairminter[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 50; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    const data: { result: CpFairminter[]; next_cursor: number | null } =
      await get(`/fairminters?limit=500&verbose=true${qs}`);
    rows.push(...data.result);
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

/** Mempool shapes. `params` is field-for-field the record /fairminters
 *  returns once confirmed, minus the two fields that only exist once mints
 *  happen — the same equivalence the web app relies on. */
interface MempoolFairminterEvent {
  tx_hash: string;
  params: Omit<CpFairminter, "earned_quantity" | "paid_quantity">;
}

interface MempoolFairmintEvent {
  tx_hash: string;
  params: {
    asset: string;
    source: string;
    earn_quantity: number | string | null;
    paid_quantity: number | string | null;
    status?: string;
    asset_info?: { divisible?: boolean } | null;
  };
}

export type { MempoolMint } from "@launchpad/xcp69/mempool";

/** Unconfirmed launches. Empty on any failure: the mempool is a nice-to-have
 *  signal, and a Counterparty hiccup should leave the header chip absent, not
 *  the page broken. */
export async function fetchMempoolFairminters(): Promise<CpFairminter[]> {
  try {
    const data = await get<{ result: MempoolFairminterEvent[] }>(
      `/mempool/events/NEW_FAIRMINTER?limit=500`,
    );
    return data.result.map((e) => ({
      ...e.params,
      earned_quantity: null,
      paid_quantity: null,
    }));
  } catch {
    return [];
  }
}

/**
 * Unconfirmed mints across every launch.
 *
 * `earn_quantity` / `paid_quantity` are per-MINT amounts here, not the
 * fairminter's running totals, so they are present on a real mint — but the
 * standing guard still applies: a malformed or invalid event can carry null,
 * and null must never reach arithmetic. Those rows are dropped rather than
 * counted as zero, which would quietly understate a total the page presents as
 * exact.
 */
export async function fetchMempoolFairmints(): Promise<MempoolMint[]> {
  try {
    const data = await get<{ result: MempoolFairmintEvent[] }>(
      `/mempool/events/NEW_FAIRMINT?limit=500`,
    );
    return data.result
      .filter(
        (e) =>
          // An invalid mint sits in the mempool but will never credit anyone.
          (e.params.status === undefined || e.params.status === "valid") &&
          e.params.earn_quantity !== null &&
          e.params.paid_quantity !== null,
      )
      .map((e) => ({
        txHash: e.tx_hash,
        asset: e.params.asset,
        source: e.params.source,
        earnQuantity: e.params.earn_quantity!,
        paidQuantity: e.params.paid_quantity!,
        divisible: e.params.asset_info?.divisible ?? true,
      }));
  } catch {
    return [];
  }
}

/** One fairminter by tx_hash — O(1), for the live room's poll tick. Never
 *  used by the main indexer pass, which already has every row from the
 *  bulk listing; this is only for the single asset someone is watching. */
export async function fetchFairminter(txHash: string): Promise<CpFairminter | null> {
  try {
    const data: { result: CpFairminter | null } = await get(
      `/fairminters/${txHash}?verbose=true`,
    );
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function fetchBlockHeight(): Promise<number> {
  const data: { result: { counterparty_height: number } } = await get("/");
  return data.result.counterparty_height;
}

/** The append-only creation event. Its own block_index is when the
 *  announcement confirmed — the one fact the /fairminters row stops being
 *  able to answer once a launch has opened. */
export async function fetchAnnounceFacts(
  txHash: string,
): Promise<{ announceBlock: number | null; originalDeadline: number | null }> {
  const data: {
    result: { block_index: number; params: { soft_cap_deadline_block: number } }[];
  } = await get(`/transactions/${txHash}/events/NEW_FAIRMINTER`);
  const event = data.result?.[0];
  return {
    announceBlock: event?.block_index ?? null,
    originalDeadline: event?.params?.soft_cap_deadline_block ?? null,
  };
}

export interface CpFairmint {
  tx_hash: string;
  block_index: number;
  source: string;
  earn_quantity: number | string;
  paid_quantity: number | string;
}

/** All mints for one fairminter, paginated to exhaustion. */
export async function fetchFairmints(fairminterTx: string): Promise<CpFairmint[]> {
  const rows: CpFairmint[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 50; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    const data: { result: CpFairmint[]; next_cursor: number | null } = await get(
      `/fairminters/${fairminterTx}/fairmints?limit=500${qs}`,
    );
    rows.push(...data.result);
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

export interface CpPool {
  asset_a: string;
  asset_b: string;
  reserve_a: number | string;
  reserve_b: number | string;
}

export async function fetchPool(asset: string): Promise<CpPool | null> {
  try {
    const data: { result: CpPool | null } = await get(
      `/pools/${encodeURIComponent(asset)}/XCP?verbose=true`,
    );
    return data.result ?? null;
  } catch {
    return null;
  }
}

/** A filled trade against a TOKEN/XCP pair, either side. Both legs arrive in
 *  one row, which is what makes this cheap: the XCP amount never has to be
 *  chased through a separate, chain-wide feed. */
export interface CpMatch {
  id?: string;
  tx_hash?: string;
  tx1_hash?: string;
  block_index: number;
  /** Pool match: the trader. The pool itself is the counterparty. */
  source?: string;
  /** Order match: `forward_asset` is what THIS address gets (order.py:697). */
  tx1_address?: string;
  /** Order match: the other side, who gets `backward_asset`. */
  tx0_address?: string;
  forward_asset: string;
  forward_quantity: number | string;
  backward_quantity: number | string;
  /** Real Unix seconds — the bucket a candle folds this fill into. */
  block_time?: number;
}

/**
 * Pool and order-book fills for one asset against XCP, newest first, stopping
 * as soon as a page reaches `sinceBlock`.
 *
 * Counterparty has no "since" filter, but it does return these in descending
 * block order, so an asset that hasn't traded since the last pass costs one
 * page and nothing else. `>=` rather than `>`: several fills can share the
 * boundary block, and the caller's INSERT OR IGNORE makes re-reading that one
 * block free.
 */
async function fetchMatches(path: string, sinceBlock: number): Promise<CpMatch[]> {
  const rows: CpMatch[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 20; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    let data: { result: CpMatch[]; next_cursor: number | null };
    try {
      data = await get(`${path}${path.includes("?") ? "&" : "?"}limit=500${qs}`);
    } catch {
      break;
    }
    rows.push(...data.result);
    // Descending order means the oldest row on this page bounds the page: once
    // it is at or below what we already have, nothing older can be new.
    const oldest = data.result[data.result.length - 1];
    if (!oldest || oldest.block_index < sinceBlock) break;
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return rows.filter((r) => r.block_index >= sinceBlock);
}

export function fetchPoolMatches(asset: string, sinceBlock: number): Promise<CpMatch[]> {
  return fetchMatches(`/pools/${encodeURIComponent(asset)}/XCP/matches?verbose=true`, sinceBlock);
}

export function fetchOrderMatches(asset: string, sinceBlock: number): Promise<CpMatch[]> {
  return fetchMatches(
    `/orders/${encodeURIComponent(asset)}/XCP/matches?status=completed&verbose=true`,
    sinceBlock,
  );
}
