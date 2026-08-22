/**
 * Portfolio value over time.
 *
 * value(b) = Σ over assets of  balanceAt(asset, b) × poolPriceAt(asset, b)
 *
 * Two things make this exact rather than approximate. Balances come from a
 * complete signed movement stream anchored to the authoritative live balance,
 * accumulated in BigInt. And price is never materialised as a number: a pool
 * quoting 690 XCP against 31,000,000 tokens prices one raw token unit at
 * ~0.000022 XCP sats, which any integer ratio would floor to zero — so each
 * snapshot's reserves are carried through and the value is computed as
 * `balance * xcpReserve / tokenReserve`, which is exact in raw units.
 *
 * The series itself is in block space. Wall-clock time, where it's needed
 * (dating a point against the daily XCP/USD calendar), comes from real
 * block_time values Counterparty returns under verbose=true — never from
 * assuming a flat ten minutes a block.
 *
 * A launch has no pool before it graduates, so there is no snapshot at or
 * before those blocks and the position is worth nothing then — which is
 * correct, and conveniently means it doesn't matter that a fairmint's tokens
 * are recorded at the mint block rather than the later block they're actually
 * credited in. Either way the value is zero until a market exists.
 */

export interface BalanceDelta {
  asset: string;
  block: number;
  /** Signed raw token units. */
  tokenDelta: bigint;
}

/**
 * Turn a complete recent movement window plus today's authoritative balances
 * into a self-contained chart stream.
 *
 * The opening delta is the balance at the boundary: live balance minus every
 * movement after it. This avoids fetching a wallet's lifetime just to learn
 * what it carried into a 1/7/30-day chart, while the dated movements preserve
 * every change inside that window exactly.
 */
export function anchorBalanceWindow(
  movements: BalanceDelta[],
  liveBalances: Map<string, string>,
  fromBlock: number,
): BalanceDelta[] {
  const netAfter = new Map<string, bigint>();
  const recent = movements.filter((movement) => movement.block > fromBlock);
  for (const movement of recent) {
    netAfter.set(
      movement.asset,
      (netAfter.get(movement.asset) ?? 0n) + movement.tokenDelta,
    );
  }

  const assets = new Set([...liveBalances.keys(), ...recent.map((movement) => movement.asset)]);
  const opening: BalanceDelta[] = [];
  for (const asset of assets) {
    const balance = BigInt(liveBalances.get(asset) ?? "0");
    const atBoundary = balance - (netAfter.get(asset) ?? 0n);
    if (atBoundary !== 0n) {
      opening.push({ asset, block: fromBlock, tokenDelta: atBoundary });
    }
  }
  return [...opening, ...recent].sort((a, b) => a.block - b.block);
}

export interface PriceSnapshot {
  block: number;
  /** Real Unix seconds from Counterparty's block_time. */
  time: number;
  xcpReserve: bigint;
  tokenReserve: bigint;
}

export interface SeriesPoint {
  block: number;
  xcpSats: bigint;
}

export interface DailyRate {
  day: string;
  usd: number;
}

/** Real (block, unix-seconds) pairs used to date a sample point. */
export interface TimeAnchor {
  block: number;
  time: number;
}

/**
 * When a block actually happened, from Counterparty's own block_time.
 *
 * Anchors come from real records — every pool snapshot carries block_time
 * under verbose=true, and the chain tip supplies one more. Between two
 * anchors this interpolates; outside them it extrapolates from the nearest
 * pair. Bitcoin block intervals vary enough that assuming a flat ten minutes
 * across a month is off by hours, which is enough to read the wrong day off a
 * daily price calendar.
 */
export function timeLookup(anchors: TimeAnchor[]) {
  const sorted = [...anchors].filter((a) => a.time > 0).sort((a, b) => a.block - b.block);
  return (block: number): number | null => {
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return sorted[0]!.time;
    if (block <= sorted[0]!.block) {
      const [a, b] = [sorted[0]!, sorted[1]!];
      const slope = (b.time - a.time) / Math.max(1, b.block - a.block);
      return a.time + (block - a.block) * slope;
    }
    const last = sorted[sorted.length - 1]!;
    if (block >= last.block) {
      const prev = sorted[sorted.length - 2]!;
      const slope = (last.time - prev.time) / Math.max(1, last.block - prev.block);
      return last.time + (block - last.block) * slope;
    }
    let lo = 0;
    let hi = sorted.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]!.block <= block) lo = mid;
      else hi = mid;
    }
    const a = sorted[lo]!;
    const b = sorted[hi]!;
    const slope = (b.time - a.time) / Math.max(1, b.block - a.block);
    return a.time + (block - a.block) * slope;
  };
}

/**
 * XCP/USD as it was at a given block, for pricing a historical point in
 * dollars.
 *
 * Returns the most recent rate at or before that day; a point older than the
 * calendar falls back to its earliest entry rather than to today's price,
 * which would be the exact error this exists to avoid.
 */
export function rateLookup(rates: DailyRate[], timeAt: (block: number) => number | null) {
  const sorted = [...rates].sort((a, b) => a.day.localeCompare(b.day));
  return (block: number): number | null => {
    if (sorted.length === 0) return null;
    const seconds = timeAt(block);
    if (seconds === null) return null;
    const day = new Date(seconds * 1000).toISOString().slice(0, 10);
    let lo = 0;
    let hi = sorted.length - 1;
    let found: DailyRate | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]!.day <= day) {
        found = sorted[mid]!;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return (found ?? sorted[0]!).usd;
  };
}

/** Latest snapshot at or before `block`, or null if the pool didn't exist yet.
 *  Snapshots must be ascending by block. */
function priceAt(snapshots: PriceSnapshot[], block: number): PriceSnapshot | null {
  let lo = 0;
  let hi = snapshots.length - 1;
  let found: PriceSnapshot | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid]!.block <= block) {
      found = snapshots[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function buildPortfolioSeries({
  deltas,
  prices,
  fromBlock,
  toBlock,
  points = 60,
}: {
  deltas: BalanceDelta[];
  prices: Map<string, PriceSnapshot[]>;
  fromBlock: number;
  toBlock: number;
  points?: number;
}): SeriesPoint[] {
  if (toBlock < fromBlock || points < 2) return [];

  // Ascending, so one forward pass can carry balances across sample points
  // instead of re-summing the whole history at each one.
  const sorted = [...deltas].sort((a, b) => a.block - b.block);
  const balances = new Map<string, bigint>();
  let cursor = 0;

  const step = (toBlock - fromBlock) / (points - 1);
  const series: SeriesPoint[] = [];

  for (let i = 0; i < points; i++) {
    const block = Math.round(fromBlock + step * i);

    // Everything at or before this sample has happened, including anything
    // before the window started — the balance entering the window is history,
    // not zero.
    while (cursor < sorted.length && sorted[cursor]!.block <= block) {
      const d = sorted[cursor]!;
      balances.set(d.asset, (balances.get(d.asset) ?? 0n) + d.tokenDelta);
      cursor++;
    }

    let total = 0n;
    for (const [asset, balance] of balances) {
      if (balance <= 0n) continue;
      const snapshots = prices.get(asset);
      if (!snapshots || snapshots.length === 0) continue;
      const p = priceAt(snapshots, block);
      if (!p || p.tokenReserve <= 0n) continue;
      total += (balance * p.xcpReserve) / p.tokenReserve;
    }
    series.push({ block, xcpSats: total });
  }

  return series;
}
