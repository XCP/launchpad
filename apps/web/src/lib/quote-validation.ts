import { parseRawInteger } from "@xcp/wallet-sdk/amounts";
import type { Raw } from "@/lib/numeric";

export interface DepositQuote {
  first_deposit: boolean;
  asset_a: string;
  asset_b: string;
  quantity_a_required: Raw | null;
  quantity_b_required: Raw | null;
  quantity_minted_estimate: Raw | null;
}
export interface WithdrawQuote {
  pool_exists: boolean;
  asset_a?: string;
  asset_b?: string;
  quantity?: Raw;
  quantity_a_estimate?: Raw;
  quantity_b_estimate?: Raw;
  supply?: Raw;
}

function requirePair(a: unknown, b: unknown, first: string, second: string) {
  if (!((a === first && b === second) || (a === second && b === first))) {
    throw new Error("quote_asset_mismatch");
  }
}

/** Core quotes canonicalize the pair, but quantity always names URL asset1. */
export function validateDepositQuote(q: DepositQuote, first: string, second: string, quantity: bigint): DepositQuote {
  requirePair(q.asset_a, q.asset_b, first, second);
  if (q.first_deposit === true) return q;
  if (q.first_deposit !== false) throw new Error("quote_invalid");
  const a = parseRawInteger(q.quantity_a_required!, { min: 1n });
  const b = parseRawInteger(q.quantity_b_required!, { min: 1n });
  parseRawInteger(q.quantity_minted_estimate!, { min: 1n });
  if ((q.asset_a === first ? a : b) !== quantity) throw new Error("quote_quantity_mismatch");
  return q;
}

export function validateWithdrawQuote(q: WithdrawQuote, first: string, second: string, quantity: bigint): WithdrawQuote {
  if (q.pool_exists !== true) throw new Error("quote_pool_unavailable");
  requirePair(q.asset_a, q.asset_b, first, second);
  if (parseRawInteger(q.quantity!) !== quantity) throw new Error("quote_quantity_mismatch");
  parseRawInteger(q.quantity_a_estimate!);
  parseRawInteger(q.quantity_b_estimate!);
  if (parseRawInteger(q.supply!, { min: 1n }) < quantity) throw new Error("quote_quantity_mismatch");
  return q;
}

export function validateSwapQuote<T extends { estimated_output: Raw; price_impact: number }>(q: T): T {
  parseRawInteger(q.estimated_output);
  if (!Number.isFinite(q.price_impact)) throw new Error("quote_invalid");
  return q;
}
