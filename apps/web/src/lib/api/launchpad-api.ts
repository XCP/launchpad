/**
 * Reads the index from launchpad-api's D1 mirror instead of deriving it from
 * a few-hundred-row Counterparty fan-out on every request. Any failure —
 * timeout, non-200, an empty or malformed body — returns null, and the
 * caller falls back to the live derivation. The API is a cache with
 * provenance, not a new source of truth: nothing here is the only place a
 * fact lives.
 */
import type { Fairminter, LaunchPhase } from "@/lib/xcp69";

const API_BASE = "https://launchpad-api.me-bbe.workers.dev";

interface ApiLaunchRow {
  tx_hash: string;
  tx_index: number;
  asset: string;
  asset_longname: string | null;
  source: string;
  divisible: number;
  start_block: number;
  end_block: number;
  price: string;
  quantity_by_price: string;
  hard_cap: string;
  soft_cap: string;
  pool_quantity: string | null;
  max_mint_per_tx: string;
  max_mint_per_address: string | null;
  premint_quantity: string;
  minted_asset_commission_int: string | null;
  burn_payment: number;
  lock_quantity: number;
  lock_description: number;
  lp_asset: string | null;
  description: string | null;
  status: string;
  phase: LaunchPhase;
  earned_quantity: string | null;
  paid_quantity: string | null;
  current_deadline_block: number;
  pool_xcp_sats: number;
}

export interface IndexedLaunch {
  fm: Fairminter;
  phase: LaunchPhase;
  conforming: true; // the API only ever stores rows that passed the verdict
  xcpDepth: bigint;
}

function toFairminter(row: ApiLaunchRow): Fairminter {
  return {
    tx_hash: row.tx_hash,
    tx_index: row.tx_index,
    // Not stored (only used by the live path to order un-indexed rows);
    // start_block is a harmless stand-in since nothing downstream reads it.
    block_index: row.start_block,
    source: row.source,
    asset: row.asset,
    asset_longname: row.asset_longname,
    description: row.description ?? "",
    price: row.price,
    quantity_by_price: row.quantity_by_price,
    hard_cap: row.hard_cap,
    soft_cap: row.soft_cap,
    soft_cap_deadline_block: row.current_deadline_block,
    start_block: row.start_block,
    end_block: row.end_block,
    burn_payment: Boolean(row.burn_payment),
    max_mint_per_tx: row.max_mint_per_tx,
    max_mint_per_address: row.max_mint_per_address,
    premint_quantity: row.premint_quantity,
    minted_asset_commission_int: row.minted_asset_commission_int,
    lock_description: Boolean(row.lock_description),
    lock_quantity: Boolean(row.lock_quantity),
    divisible: Boolean(row.divisible),
    pool_quantity: row.pool_quantity,
    lp_asset: row.lp_asset,
    status: row.status,
    earned_quantity: row.earned_quantity,
    paid_quantity: row.paid_quantity,
  };
}

export interface FeeSummary {
  totalFeeSats: number;
  counted: number;
  mints: number;
}

interface ApiFeeSummary {
  total_fee_sats: number;
  counted: number;
  mints: number;
}

/** Bitcoin-side fee total for a launch's mints — data only apps/api has
 *  (fetched server-side from mempool.space, once per mint, ever); the live
 *  Counterparty derivation has no equivalent to fall back to, so a failure
 *  here just hides the stat. */
export async function fetchLaunchFees(asset: string): Promise<FeeSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/launches/${asset}/fees`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiFeeSummary | null };
    if (!data.result) return null;
    return {
      totalFeeSats: data.result.total_fee_sats,
      counted: data.result.counted,
      mints: data.result.mints,
    };
  } catch {
    return null;
  }
}

export async function fetchIndexedLaunches(
  perPhase: number,
): Promise<IndexedLaunch[] | null> {
  try {
    const res = await fetch(`${API_BASE}/v2/launches?per_phase=${perPhase}`, {
      signal: AbortSignal.timeout(3_000),
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: ApiLaunchRow[] };
    if (!Array.isArray(data.result)) return null;
    return data.result.map((row) => ({
      fm: toFairminter(row),
      phase: row.phase,
      conforming: true as const,
      xcpDepth: BigInt(Math.trunc(row.pool_xcp_sats) || 0),
    }));
  } catch {
    return null;
  }
}
