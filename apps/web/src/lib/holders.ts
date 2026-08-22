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
