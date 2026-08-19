/**
 * The mempool wire contract, shared because both sides of it live in this
 * repo.
 *
 * apps/api serialises these and apps/web consumes them verbatim — no mapping
 * layer, the field names on the wire ARE the field names in the component. Two
 * separate declarations of that shape would be two things that must agree with
 * nothing making them, and the failure would be quiet: a renamed field reads as
 * `undefined`, which formats as a blank rather than an error. This is the same
 * argument that put the XCP-69 predicate in this package instead of leaving a
 * copy on each side.
 *
 * camelCase, unlike every other payload this API serves. That is deliberate
 * and it is the exception: these rows are handed straight to React, so naming
 * them the way the rest of the API names its columns would mean a mapping pass
 * whose only purpose was to undo a convention.
 */
import type { Raw } from "./numeric";

/** One unconfirmed mint, as the mempool reports it. */
export interface MempoolMint {
  txHash: string;
  asset: string;
  source: string;
  /** Raw token units the minter earns. */
  earnQuantity: Raw;
  /** Raw XCP satoshi paid. */
  paidQuantity: Raw;
  divisible: boolean;
}

/** One unconfirmed XCP order involving an xcp.fun launch asset. */
export interface MempoolOrder {
  txHash: string;
  source: string;
  asset: string;
  giveAsset: string;
  getAsset: string;
  giveQuantity: Raw;
  getQuantity: Raw;
}
