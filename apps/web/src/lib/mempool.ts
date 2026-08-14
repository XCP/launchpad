import type { MempoolMint } from "@/lib/api/counterparty";
import { big } from "@/lib/numeric";

/**
 * Everything one address has queued, summed.
 *
 * Grouping by address rather than listing transactions is the whole point of
 * the Mints tab: a minter taking ten lots is one person doing one thing, and
 * ten rows saying so reads as ten people.
 */
export interface MinterGroup {
  source: string;
  /** Distinct assets this address is minting, in first-seen order. */
  assets: string[];
  mints: number;
  /** Raw token units earned across those mints. */
  tokensRaw: bigint;
  /** Raw XCP satoshi paid across those mints. */
  xcpRaw: bigint;
  /** False only if every asset in the group is indivisible. */
  divisible: boolean;
}

/**
 * Sum mempool mints per address.
 *
 * Ordered by XCP committed, descending — the same "who is most in" ranking
 * the minters table uses, so the two read the same way. Ties keep insertion
 * order, which is the mempool's own, so equal rows don't shuffle between
 * polls; a table that reorders under a stationary cursor looks broken even
 * when the numbers are right.
 */
export function groupMintsByAddress(mints: MempoolMint[]): MinterGroup[] {
  const groups = new Map<string, MinterGroup>();

  for (const m of mints) {
    let g = groups.get(m.source);
    if (!g) {
      g = {
        source: m.source,
        assets: [],
        mints: 0,
        tokensRaw: 0n,
        xcpRaw: 0n,
        divisible: false,
      };
      groups.set(m.source, g);
    }
    if (!g.assets.includes(m.asset)) g.assets.push(m.asset);
    g.mints += 1;
    // Exact: token amounts run to 1e16, past where a double still names a
    // single integer.
    g.tokensRaw += big(m.earnQuantity);
    g.xcpRaw += big(m.paidQuantity);
    g.divisible = g.divisible || m.divisible;
  }

  return [...groups.values()].sort((a, b) =>
    a.xcpRaw === b.xcpRaw ? 0 : a.xcpRaw > b.xcpRaw ? -1 : 1,
  );
}
