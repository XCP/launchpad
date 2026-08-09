/**
 * The only module in this worker allowed to call the Counterparty API. The
 * poller reads through here; every read route answers from D1.
 */
import { parseJsonLossless } from "@launchpad/xcp69/numeric";

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
