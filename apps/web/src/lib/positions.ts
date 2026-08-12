/**
 * Cost basis and PnL for XCP-69 positions.
 *
 * Input is a stream of ALREADY-PAIRED deltas — each carries both what moved in
 * tokens and what moved in XCP. That pairing used to happen here, by grouping
 * an address's entire Counterparty credit/debit ledger by event hash, which
 * meant the browser paginating ~14,000 rows (17 requests) on every refresh to
 * find the handful concerning XCP-69 assets. apps/api now does that pairing
 * once, server-side, so the same answer arrives in one request.
 *
 * Average-cost accounting: a disposal removes basis pro-rata and realizes the
 * difference, so the remaining basis always describes the remaining tokens.
 *
 * Everything is raw integer satoshi, BigInt throughout. A position's value is
 * `balance * poolXcpReserve / poolTokenReserve`, which is exact in raw units —
 * the pool ratio is already "XCP sats per raw token unit", so no divisibility
 * conversion enters the money math at all.
 */
import { big, type Raw } from "@/lib/numeric";

/** One acquisition or disposal, both legs known. */
export interface PairedDelta {
  asset: string;
  block: number;
  /** Signed raw token units: positive acquired, negative disposed. */
  tokenDelta: bigint;
  /** Signed XCP sats: negative paid, positive received. */
  xcpDelta: bigint;
}

export interface PositionInput {
  /** Graduated, conforming launches only — the universe we price. */
  asset: string;
  poolXcpReserve: Raw;
  poolTokenReserve: Raw;
}

export interface Position {
  asset: string;
  /** Live on-chain balance, the authority for what is actually held. */
  balance: bigint;
  /** XCP paid for the balance still held, or null when unknowable. */
  costXcpSats: bigint | null;
  valueXcpSats: bigint;
  /** value - cost, or null when basis is unknowable. */
  unrealizedXcpSats: bigint | null;
  /** Realized on tokens already disposed of. */
  realizedXcpSats: bigint;
  /** Why PnL is withheld, if it is. */
  withheld?: string;
}

export interface ClosedPosition {
  asset: string;
  realizedXcpSats: bigint;
}

interface Book {
  qty: bigint;
  cost: bigint;
  realized: bigint;
  /** Tokens that arrived with no XCP leg and no market price to value them. */
  unpriced: boolean;
  everHeld: boolean;
}

/**
 * @param priceAt Optional XCP-sats-per-raw-token at a block, used to value
 *   plain transfers in — tokens that arrived without payment still have a cost
 *   basis, just not one the ledger states. Without it such a position reports
 *   no PnL rather than a flattering one.
 */
export function computePositions(
  deltas: PairedDelta[],
  universe: PositionInput[],
  liveBalances: Map<string, Raw>,
  priceAt?: (asset: string, block: number) => bigint | null,
): { open: Position[]; closed: ClosedPosition[] } {
  const priced = new Set(universe.map((u) => u.asset));

  const books = new Map<string, Book>();
  const book = (asset: string): Book => {
    let b = books.get(asset);
    if (!b) {
      b = { qty: 0n, cost: 0n, realized: 0n, unpriced: false, everHeld: false };
      books.set(asset, b);
    }
    return b;
  };

  for (const d of [...deltas].sort((a, b) => a.block - b.block)) {
    if (!priced.has(d.asset) || d.tokenDelta === 0n) continue;
    const b = book(d.asset);
    b.everHeld = true;

    if (d.tokenDelta > 0n) {
      let cost = d.xcpDelta < 0n ? -d.xcpDelta : 0n;
      if (cost === 0n) {
        // Tokens that arrived without payment still have a basis, just not one
        // the chain states. Marked to the market at the time if we can price
        // it; otherwise the position reports no PnL rather than a flattering one.
        const mark = priceAt?.(d.asset, d.block) ?? null;
        if (mark === null) b.unpriced = true;
        else cost = mark * d.tokenDelta;
      }
      b.qty += d.tokenDelta;
      b.cost += cost;
    } else {
      const sold = -d.tokenDelta;
      const proceeds = d.xcpDelta > 0n ? d.xcpDelta : 0n;
      const basis = b.qty > 0n ? (b.cost * sold) / b.qty : 0n;
      b.realized += proceeds - basis;
      b.cost -= basis;
      b.qty -= sold;
      if (b.qty < 0n) b.qty = 0n;
    }
  }

  const open: Position[] = [];
  const closed: ClosedPosition[] = [];

  for (const u of universe) {
    const b = books.get(u.asset);
    const live = big(liveBalances.get(u.asset) ?? "0");
    const tokenReserve = big(u.poolTokenReserve);
    const valueXcpSats =
      tokenReserve > 0n ? (live * big(u.poolXcpReserve)) / tokenReserve : 0n;

    if (live <= 0n) {
      // Fully exited — only interesting if they ever held it.
      if (b?.everHeld) closed.push({ asset: u.asset, realizedXcpSats: b.realized });
      continue;
    }

    // The ledger is a reconstruction; the balance is a fact. If they disagree,
    // something happened this model didn't see, and every number derived from
    // it is suspect — so report the value (which needs no history) and withhold
    // the rest rather than publish a confident wrong figure.
    let withheld: string | undefined;
    if (!b) withheld = "no history found for this asset";
    else if (b.unpriced) withheld = "received tokens with no recorded price";
    else if (b.qty !== live) withheld = "history doesn't reconcile with the live balance";

    open.push({
      asset: u.asset,
      balance: live,
      costXcpSats: withheld ? null : b!.cost,
      valueXcpSats,
      unrealizedXcpSats: withheld ? null : valueXcpSats - b!.cost,
      realizedXcpSats: b?.realized ?? 0n,
      withheld,
    });
  }

  open.sort((a, b) => (b.valueXcpSats > a.valueXcpSats ? 1 : b.valueXcpSats < a.valueXcpSats ? -1 : 0));
  return { open, closed };
}
