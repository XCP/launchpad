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
 * How much of the liquidity behind the pool's tokens can never be pulled.
 *
 * The holders table used to caption the pool "Locked pool · LP burned"
 * unconditionally. That was true by luck, not by check: an XCP-69 graduation
 * burns its LP, so every pool happened to be fully locked and nothing enforced
 * it. The first deposit that KEPT its LP would have had a withdrawable position
 * captioned as permanently burned — the table asserting a guarantee that does
 * not exist.
 *
 * ONE row, not two. An earlier pass split the pool into "Locked" and "Unlocked"
 * rows, which reads well in isolation and is wrong in a ranking: the pool is a
 * single concentration of supply, and cutting it in half understates it twice
 * over while reordering the table around a boundary that is not a holder. The
 * lock is a property OF the pool row, so it belongs on that row as a qualifier.
 *
 * `lockedPercent` FLOORS, and `fullyLocked` is an exact equality rather than a
 * percentage test. 99.6% burned must read "99% burned", never "100%": rounding
 * up would manufacture the same false guarantee this function exists to
 * prevent, just three decimal places further in. Claim less than is true, never
 * more.
 */
export function poolLockStatus(
  poolTokens: bigint,
  lpBalances: LpBalance[],
  burnAddresses: Iterable<string>,
): { locked: bigint; unlocked: bigint; lockedPercent: number; fullyLocked: boolean } {
  const burnt = new Set(burnAddresses);
  let total = 0n;
  let burned = 0n;
  for (const row of lpBalances) {
    const q = big(row.quantity);
    if (q <= 0n) continue;
    total += q;
    if (row.address && burnt.has(row.address)) burned += q;
  }
  // No LP supply visible is not evidence of a burn. Claim nothing.
  if (total <= 0n) {
    return { locked: 0n, unlocked: poolTokens, lockedPercent: 0, fullyLocked: false };
  }
  const locked = (poolTokens * burned) / total;
  return {
    locked,
    unlocked: poolTokens - locked,
    lockedPercent: Number((burned * 100n) / total),
    fullyLocked: burned === total,
  };
}
