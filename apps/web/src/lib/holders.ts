import { big, compareRawDesc, type Raw } from "@/lib/numeric";

export interface AssetBalanceLocation {
  address: string | null;
  utxo: string | null;
  quantity: Raw;
}

export interface HolderRow {
  /** An ordinary address, or `utxo:<txid:vout>` when no address owns the row. */
  address: string;
  quantity: bigint;
}

/**
 * One row per ownership location, including locations whose live balance is
 * zero. Counterparty can return an address more than once (for example an
 * address balance plus UTXO-attached balances), so counting wire rows is not
 * counting holders.
 */
export function coalesceHolderBalances(
  balances: AssetBalanceLocation[],
): HolderRow[] {
  const byOwner = new Map<string, bigint>();
  for (const row of balances) {
    const owner = row.address ?? (row.utxo ? `utxo:${row.utxo}` : null);
    if (!owner) continue;
    byOwner.set(owner, (byOwner.get(owner) ?? 0n) + big(row.quantity));
  }
  return [...byOwner.entries()]
    .map(([address, quantity]) => ({ address, quantity }))
    .sort((a, b) => compareRawDesc(a.quantity, b.quantity));
}

/** Current holders, as opposed to the historical ownership rows above. */
export function currentHolderCount(rows: HolderRow[]): number {
  return rows.filter((row) => row.quantity > 0n).length;
}

/**
 * Add addresses known to have held the asset without letting historical rows
 * affect the live holder count. The balances endpoint only returns current
 * locations, so minters and traders who fully exited have to be restored from
 * the launch/market tapes if the table is meant to retain that history.
 */
export function includeFormerHolders(
  current: HolderRow[],
  historicalAddresses: Iterable<string>,
): HolderRow[] {
  const byOwner = new Map(current.map((row) => [row.address, row.quantity]));
  for (const address of historicalAddresses) {
    if (address && !byOwner.has(address)) byOwner.set(address, 0n);
  }
  return [...byOwner.entries()]
    .map(([address, quantity]) => ({ address, quantity }))
    .sort((a, b) => compareRawDesc(a.quantity, b.quantity));
}

/** One LP balance location, from the LP asset's own balances endpoint. */
export interface LpBalance {
  address: string | null;
  quantity: Raw;
}

/**
 * The pool's tokens, split by whether the liquidity behind them can be pulled.
 *
 * The holders table used to show the pool as a single row captioned "Locked
 * pool · LP burned", which was true by luck rather than by check: an XCP-69
 * graduation burns its LP, so every pool on the site happened to be fully
 * locked. Nothing enforced it. The first person to deposit liquidity WITHOUT
 * burning the LP would have had their withdrawable position captioned as
 * burned, and the table would have been asserting a guarantee that did not
 * exist — the single most misleading thing this page could say.
 *
 * Locked share is measured, not assumed: LP sitting at a provably unspendable
 * address against total LP outstanding. Pool tokens divide on that ratio,
 * because an LP token is a claim on a proportion of both reserves.
 *
 * Integer math throughout, and `unlocked` is the REMAINDER rather than a second
 * division, so the two always sum to the pool exactly and the rounding dust
 * (at most one raw unit) lands on the unlocked side — the side that claims
 * less, which is the right direction for a number people trust.
 */
export function splitPoolByLock(
  poolTokens: bigint,
  lpBalances: LpBalance[],
  burnAddresses: Iterable<string>,
): { locked: bigint; unlocked: bigint } {
  const burnt = new Set(burnAddresses);
  let total = 0n;
  let burned = 0n;
  for (const row of lpBalances) {
    const q = big(row.quantity);
    if (q <= 0n) continue;
    total += q;
    if (row.address && burnt.has(row.address)) burned += q;
  }
  // No LP supply visible means no basis for the claim. Report it all unlocked
  // rather than defaulting to locked: the caption has to be earned.
  if (total <= 0n) return { locked: 0n, unlocked: poolTokens };
  const locked = (poolTokens * burned) / total;
  return { locked, unlocked: poolTokens - locked };
}
