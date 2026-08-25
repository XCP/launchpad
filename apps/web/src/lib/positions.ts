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
/**
 * Why a position's PnL cannot be stated.
 *
 * A CODE, not a sentence. The wording belongs to whatever is rendering it —
 * these reached the screen as `title` attributes, which is a tooltip nobody
 * hovers for a full second and nobody on a phone can reach at all, so the user
 * saw a bare dash and no reason. Naming the cases lets each surface say them in
 * its own voice, and lets the closed list say them at all.
 *
 *  untracked    — the wallet holds the token, but this site records no mint or
 *                 trade for it, so there is no cost to measure against.
 *  unpriced     — tokens arrived by transfer at a moment nothing could price.
 *  unreconciled — the live balance disagrees with the mints and trades tracked
 *                 here, so something moved where this page cannot see it.
 */
export type WithheldReason = "untracked" | "unpriced" | "unreconciled";

export interface PairedDelta {
  asset: string;
  block: number;
  /** Signed raw token units: positive acquired, negative disposed. */
  tokenDelta: bigint;
  /** Signed XCP sats: negative paid, positive received. */
  xcpDelta: bigint;
  /** A transfer across the wallet boundary, not a purchase or sale. Incoming
   * flows enter at their contemporaneous market value; outgoing flows carry
   * basis out without realizing profit or loss. */
  external?: boolean;
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
  withheld?: WithheldReason;
}

export interface ClosedPosition {
  asset: string;
  /** Null when the focused event history does not explain the live zero. */
  realizedXcpSats: bigint | null;
  withheld?: WithheldReason;
}

/** Whole-position PnL, including profit already realized by partial sales. */
export function totalPnlXcpSats(position: Position): bigint | null {
  return position.unrealizedXcpSats === null
    ? null
    : position.realizedXcpSats + position.unrealizedXcpSats;
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
 * `valueAt` prices an incoming external quantity as a whole. Pool prices are
 * rational reserve ratios, usually below one XCP sat per raw token unit, so a
 * rounded integer unit price would silently value most divisible tokens at 0.
 */
export function computePositions(
  deltas: PairedDelta[],
  universe: PositionInput[],
  liveBalances: Map<string, Raw>,
  valueAt?: (asset: string, block: number, quantity: bigint) => bigint | null,
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
      if (d.external) {
        const mark = valueAt?.(d.asset, d.block, d.tokenDelta) ?? null;
        if (mark === null) b.unpriced = true;
        else cost = mark;
      } else if (cost === 0n) {
        b.unpriced = true;
      }
      b.qty += d.tokenDelta;
      b.cost += cost;
    } else {
      const sold = -d.tokenDelta;
      const proceeds = d.xcpDelta > 0n ? d.xcpDelta : 0n;
      const basis = b.qty > 0n ? (b.cost * sold) / b.qty : 0n;
      if (!d.external) b.realized += proceeds - basis;
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

    // A pool sale can never hand back the entire balance: the constant-product
    // maths divides in integers, so selling out leaves a few raw units behind.
    // 4,986 raw CAPTAINDAN prices at 0.22 XCP satoshi, which floors to zero —
    // the wallet is out, but a `live > 0` test keeps the position open forever,
    // printing a 0.00 holding worth $0 with its realised PnL stranded beside it.
    //
    // The line is "worth less than one satoshi", not a token count, because a
    // count means different things either side of divisibility and because this
    // is the honest statement: what remains cannot be sold for anything.
    // Guarded on a live pool — without one nothing can be priced, and a real
    // holding would be indistinguishable from crumbs.
    const dust = live > 0n && tokenReserve > 0n && valueXcpSats === 0n;

    if (live <= 0n || dust) {
      // Fully exited — only interesting if they ever held it.
      if (b?.everHeld)
        closed.push(
          b.qty === live
            ? { asset: u.asset, realizedXcpSats: b.realized }
            : {
                asset: u.asset,
                realizedXcpSats: null,
                withheld: "unreconciled",
              },
        );
      continue;
    }

    // The ledger is a reconstruction; the balance is a fact. If they disagree,
    // something happened this model didn't see, and every number derived from
    // it is suspect — so report the value (which needs no history) and withhold
    // the rest rather than publish a confident wrong figure.
    let withheld: WithheldReason | undefined;
    if (!b) withheld = "untracked";
    else if (b.unpriced) withheld = "unpriced";
    else if (b.qty !== live) withheld = "unreconciled";

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
