import type { MempoolMint } from "@launchpad/xcp69/mempool";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { big, parseJsonLossless, ratio, type Raw } from "@/lib/numeric";
import type { Fairminter } from "@/lib/xcp69";

interface Paginated<T> {
  result: T[];
  next_cursor: number | null;
  result_count: number;
}

async function get<T>(path: string, revalidate = 60): Promise<T> {
  const res = await fetch(`${COUNTERPARTY_API_BASE}${path}`, {
    // Counterparty is a third party we do not run, and this is the shared
    // client behind every server-rendered read. Without a deadline a stalled
    // node holds the Worker invocation open and delays the HTML for everyone
    // on that route; the throw below is what callers already handle.
    signal: AbortSignal.timeout(8_000),
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`Counterparty API ${res.status}: ${path}`);
  // Not res.json(): JSON.parse rounds integers above 2^53-1; oversized
  // integers arrive as strings instead.
  return parseJsonLossless<T>(await res.text());
}

/** One balance-changing entry. Credits and debits are the same fact with
 *  opposite signs, so they're merged into one stream rather than two lists. */
export interface LedgerEntry {
  block: number;
  asset: string;
  quantity: Raw;
  direction: 1 | -1;
  /** `calling_function` on a credit, `action` on a debit. */
  reason: string;
  /** Shared by every leg of one action — an `escrowed fairmint` debit and the
   *  `fairmint refund` credit that answers it carry the same event even though
   *  they land in different blocks. This is what pairs XCP paid with what it
   *  bought. */
  event: string;
}

interface RawCredit {
  block_index: number;
  asset: string;
  quantity: Raw;
  calling_function: string;
  event: string;
}
interface RawDebit {
  block_index: number;
  asset: string;
  quantity: Raw;
  action: string;
  event: string;
}

async function pageAll<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: number | null = null;
  do {
    const page: Paginated<T> = await get(
      `${path}${path.includes("?") ? "&" : "?"}limit=1000${cursor !== null ? `&cursor=${cursor}` : ""}`,
      30,
    );
    all.push(...page.result);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return all;
}

/** Every credit and debit for an address, oldest first. Paginated to
 *  exhaustion — a partial ledger produces a confidently wrong cost basis,
 *  which is worse than none. */
export async function fetchAddressLedger(address: string): Promise<LedgerEntry[]> {
  const addr = encodeURIComponent(address);
  const [credits, debits] = await Promise.all([
    pageAll<RawCredit>(`/addresses/${addr}/credits`),
    pageAll<RawDebit>(`/addresses/${addr}/debits`),
  ]);
  const entries: LedgerEntry[] = [
    ...credits.map((c) => ({
      block: c.block_index,
      asset: c.asset,
      quantity: c.quantity,
      direction: 1 as const,
      reason: c.calling_function,
      event: c.event,
    })),
    ...debits.map((d) => ({
      block: d.block_index,
      asset: d.asset,
      quantity: d.quantity,
      direction: -1 as const,
      reason: d.action,
      event: d.event,
    })),
  ];
  return entries.sort((a, b) => a.block - b.block);
}

export interface AddressBalance {
  asset: string;
  quantity: Raw;
}

/** Confirmed balances for an address, keyed by asset. UTXO-attached balances
 *  are included: they are still the address's holdings. */
export async function fetchAddressBalances(address: string): Promise<Map<string, Raw>> {
  const rows = await pageAll<{ asset: string; quantity: Raw }>(
    `/addresses/${encodeURIComponent(address)}/balances`,
  );
  const out = new Map<string, Raw>();
  for (const r of rows) {
    const prev = out.get(r.asset);
    out.set(r.asset, (prev === undefined ? big(r.quantity) : big(prev) + big(r.quantity)).toString());
  }
  return out;
}

export interface HolderConcentration {
  /** Share of total supply held by the ten largest addresses, 0–100. */
  top10Pct: number;
  /** Share held by the launch's creator, 0–100. */
  devPct: number;
}

/**
 * Live number of distinct positive-balance holders for an asset.
 *
 * This deliberately uses the same Counterparty balance endpoint as the
 * Holders tab.  The explorer's denormalized `holder_count` can lag a newly
 * graduated launch by several blocks, which made the page header claim one
 * holder while the table already contained the full mint population.
 * Address balances are coalesced by address; address-less UTXO balances use
 * the UTXO itself as their ownership location.
 */
export async function fetchHolderCount(asset: string): Promise<number | null> {
  try {
    const rows = await pageAll<{
      address: string | null;
      utxo: string | null;
      quantity: Raw;
    }>(`/assets/${encodeURIComponent(asset)}/balances`);
    const holders = new Set<string>();
    for (const row of rows) {
      if (big(row.quantity) <= 0n) continue;
      if (row.address) holders.add(`address:${row.address}`);
      else if (row.utxo) holders.add(`utxo:${row.utxo}`);
    }
    return holders.size;
  } catch {
    return null;
  }
}

/**
 * How concentrated the holder base is.
 *
 * Measured against TOTAL SUPPLY, not the sum of address balances, because the
 * pool's own reserve is not an address balance — a graduated XCP-69 launch has
 * ~31% of supply sitting in the locked pool, and dividing by holders alone
 * would inflate every percentage by that much and make a normal distribution
 * look like a cartel.
 *
 * Percentages go through ratio(), which divides in BigInt before narrowing:
 * supply here is 1e16 raw, well past what a double holds exactly.
 */
export async function fetchHolderConcentration(
  asset: string,
  creator: string,
  supplyRaw: Raw,
): Promise<HolderConcentration> {
  const supply = big(supplyRaw);
  if (supply <= 0n) return { top10Pct: 0, devPct: 0 };
  try {
    const rows = await pageAll<{ address: string | null; quantity: Raw }>(
      `/assets/${encodeURIComponent(asset)}/balances`,
    );
    const held = rows
      .filter((r) => big(r.quantity) > 0n)
      .map((r) => ({ address: r.address, qty: big(r.quantity) }));

    const byAddress = new Map<string, bigint>();
    for (const r of held) {
      const key = r.address ?? "(utxo)";
      byAddress.set(key, (byAddress.get(key) ?? 0n) + r.qty);
    }
    const sorted = [...byAddress.values()].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
    const top10 = sorted.slice(0, 10).reduce((sum, q) => sum + q, 0n);
    const dev = byAddress.get(creator) ?? 0n;

    // ratio() scales through bigint division before narrowing, which is the
    // whole reason it exists — supply here is 1e16.
    const pct = (part: bigint) => ratio(part, supply) * 100;
    return { top10Pct: pct(top10), devPct: pct(dev) };
  } catch {
    return { top10Pct: 0, devPct: 0 };
  }
}

/** One asset's confirmed balance for one address. Answers the only balance
 *  question the profile actually asks, without paging every asset held. */
export async function fetchAssetBalance(address: string, asset: string): Promise<string> {
  try {
    const data = await get<{ result: { quantity: Raw }[] }>(
      `/addresses/${encodeURIComponent(address)}/balances/${encodeURIComponent(asset)}`,
      30,
    );
    return (data.result ?? [])
      .reduce((sum, r) => sum + big(r.quantity), 0n)
      .toString();
  } catch {
    return "0";
  }
}

/**
 * All fairminters, following next_cursor to the end (the old site's hardcoded
 * limit=200 silently dropped a third of the records). The XCP-69 universe is
 * small; pages are cached per-URL by Next's fetch cache.
 */
export async function fetchAllFairminters(revalidate = 60): Promise<Fairminter[]> {
  const all: Fairminter[] = [];
  let cursor: number | null = null;
  do {
    const page: Paginated<Fairminter> = await get(
      `/fairminters?limit=1000&verbose=true${cursor !== null ? `&cursor=${cursor}` : ""}`,
      revalidate,
    );
    all.push(...page.result);
    cursor = page.next_cursor;
  } while (cursor !== null);
  return all;
}

/** Fairminters opened on an asset; the XCP-69 one (if any) is what we show. */
export async function fetchFairmintersByAsset(asset: string): Promise<Fairminter[]> {
  const data = await get<Paginated<Fairminter>>(
    `/assets/${encodeURIComponent(asset)}/fairminters?limit=100&verbose=true`,
    30,
  );
  return data.result;
}

export async function fetchFairminter(txHash: string): Promise<Fairminter | null> {
  const data = await get<{ result: Fairminter | null }>(
    `/fairminters/${txHash}?verbose=true`,
    30,
  );
  return data.result ?? null;
}

export interface Fairmint {
  tx_hash: string;
  block_index: number;
  source: string;
  fairminter_tx_hash: string;
  asset: string;
  earn_quantity: Raw;
  paid_quantity: Raw;
  commission: Raw;
  status: string;
}

/**
 * Every mint on one fairminter, paginated to exhaustion.
 *
 * One page was not the history. A launch needs 69 distinct addresses to close
 * and nothing obliges any of them to mint their whole allowance at once, so a
 * busy launch can run past a single page — at which point the mint list, the
 * holder table and the minter count all quietly describe a prefix.
 */
export async function fetchFairmints(fairminterTxHash: string): Promise<Fairmint[]> {
  return pageAll<Fairmint>(`/fairminters/${fairminterTxHash}/fairmints?verbose=true`);
}

/**
 * Distinct addresses that have minted, counted the way apps/api's indexer
 * counts them (`new Set(sources).size`). This is what the homepage falls back
 * to when that indexer can't be reached, so the two have to agree on the
 * number rather than on the idea of one.
 *
 * Null on failure, meaning NOT COUNTED — which is not the fact zero states. A
 * card reading "0 of 69 minters" beside its own progress bar at 43% is
 * contradicted by the rest of the card.
 */
export async function fetchMinterCount(
  fairminterTxHash: string,
): Promise<number | null> {
  try {
    const mints = await fetchFairmints(fairminterTxHash);
    return new Set(mints.map((m) => m.source)).size;
  } catch {
    return null;
  }
}

export interface Pool {
  asset_a: string;
  asset_b: string;
  reserve_a: Raw;
  reserve_b: Raw;
  lp_asset: string;
  reserve_a_normalized?: string;
  reserve_b_normalized?: string;
}

/**
 * Reserve snapshots for the TOKEN/XCP pair, one row per pool state change
 * (deposits, withdrawals, and every swap). Ascending by tx_index after the
 * client-side reverse; price = reserve ratio at each point.
 */
export interface PoolSnapshot {
  block_index: number;
  tx_index: number;
  asset_a: string;
  asset_b: string;
  reserve_a: Raw;
  reserve_b: Raw;
  /** Real Unix seconds, via verbose=true — not derived from block distance. */
  block_time: number;
}

export async function fetchPoolPriceHistory(
  asset: string,
  maxPages = 5,
): Promise<PoolSnapshot[]> {
  const rows: PoolSnapshot[] = [];
  let cursor: number | null = null;
  let pages = 0;
  do {
    const page: Paginated<PoolSnapshot> = await get(
      `/pools/${encodeURIComponent(asset)}/XCP/price_history?verbose=true&limit=1000${
        cursor !== null ? `&cursor=${cursor}` : ""
      }`,
      30,
    );
    rows.push(...page.result);
    cursor = page.next_cursor;
    pages++;
  } while (cursor !== null && pages < maxPages);
  return rows.reverse();
}

/** TOKEN/XCP pool for an asset, or null — the launched-vs-refunded oracle. */
export async function fetchPool(asset: string): Promise<Pool | null> {
  try {
    const data = await get<{ result: Pool | null }>(
      `/pools/${encodeURIComponent(asset)}/XCP?verbose=true`,
      60,
    );
    return data.result ?? null;
  } catch {
    return null;
  }
}

/**
 * The composed soft_cap_deadline_block from the immutable NEW_FAIRMINTER
 * event. The fairminters row is REWRITTEN on an early sell-out (core pulls
 * the deadline forward to the fill block), so for closed launches only the
 * event history preserves the original window. Closed records never change —
 * cache long.
 */
export async function fetchOriginalDeadline(txHash: string): Promise<number | null> {
  return (await fetchOriginalRecord(txHash)).deadline;
}

/**
 * The fairminter as it was created. The `/fairminters` row mutates —
 * `block_index` is rewritten to the block the launch OPENS in, and a closed
 * row's `soft_cap_deadline_block` becomes the settlement block — so neither
 * field can answer a question about creation. The NEW_FAIRMINTER event is
 * append-only and can: its own block_index is the block the announcement
 * confirmed in, which is what pre-announcement has to be measured against.
 */
export async function fetchOriginalRecord(
  txHash: string,
): Promise<{ deadline: number | null; announceBlock: number | null }> {
  const data = await get<{
    result: {
      block_index: number;
      params: { soft_cap_deadline_block: number };
    }[];
    // Append-only: a launch's creation event never changes, so this is
    // asked once per launch rather than once an hour per launch.
  }>(`/transactions/${txHash}/events/NEW_FAIRMINTER`, 31_536_000);
  const event = data.result?.[0];
  return {
    deadline: event?.params?.soft_cap_deadline_block ?? null,
    announceBlock: event?.block_index ?? null,
  };
}

/**
 * Open XCP dispensers, cheapest first. Non-oracle only (oracle dispensers
 * price via an external feed, so the BTC trigger amount can't be computed
 * safely client-side) and single-unit only (give_quantity of exactly 1 XCP)
 * so quantities read one-XCP-at-a-time and the presets land exactly.
 * `price` is the API's computed sats per whole XCP.
 *
 * Plain numbers, unlike the fairminter and pool records: every field here is
 * bounded by XCP's own supply (~2.6M, so 2.6e14 raw) or by a Bitcoin sat
 * amount, both an order of magnitude clear of 2^53. Nothing arrives as a
 * string, so nothing needs the exact path.
 */
export interface Dispenser {
  tx_hash: string;
  source: string;
  give_quantity: number;
  give_remaining: number;
  satoshirate: number;
  price: number;
}

export async function fetchXcpDispensers(limit = 10): Promise<Dispenser[]> {
  const data = await get<Paginated<Dispenser>>(
    `/assets/XCP/dispensers?status=open&exclude_with_oracle=true&sort=price:asc&limit=100`,
    60,
  );
  return data.result
    .filter((d) => d.give_remaining > 0 && d.give_quantity === 1e8)
    .slice(0, limit);
}

interface PoolMatch {
  status: string;
  /** The trader. The pool is the counterparty and has no address. */
  source: string;
  /** What the trader RECEIVES (ledger/markets.py credits exactly this), so
   *  the token arriving means they bought it. */
  forward_asset: string;
  forward_quantity: Raw;
  backward_asset: string;
  backward_quantity: Raw;
  block_time: number;
}

export interface PoolVolume {
  /** Stringified bigint — crosses the server/client prop boundary like
   *  every other raw quantity in this codebase; convert with big(). */
  volumeXcpRaw: Raw;
  trades: number;
  /** Direction split over the same window. Buys and sells are counted from
   *  the trader's side; buyers and sellers are DISTINCT addresses, which is
   *  the number that says whether activity is a crowd or one wallet going
   *  back and forth. */
  buys: number;
  sells: number;
  buyVolXcpRaw: Raw;
  sellVolXcpRaw: Raw;
  buyers: number;
  sellers: number;
}

/**
 * Trailing 24h swap volume + trade count for the TOKEN/XCP pool, computed
 * from the pool's own match history rather than a third-party aggregate —
 * matches page newest-first, so this stops as soon as it walks outside the
 * window instead of always paging to `maxPages`.
 */
interface OrderMatch {
  status: string;
  /** The order that came in and matched — the aggressor, and the side whose
   *  direction a buy/sell figure means. */
  tx1_address: string;
  /** The resting order the aggressor hit. A real trader with a real position
   *  on the opposite side of the same fill. */
  tx0_address?: string;
  /** What tx1 RECEIVES (messages/order.py sets this from tx1's get_asset). */
  forward_asset: string;
  forward_quantity: Raw;
  backward_quantity: Raw;
  block_time: number;
}

/**
 * Trading over the last 24 hours across BOTH venues on the pair.
 *
 * A single order here can fill against the pool and against resting orders in
 * the same execution — the two are interleaved, not alternatives — so counting
 * only pool matches undercounts real activity. Both are walked and merged.
 *
 * Direction is always the taker's: `source` for a pool fill, `tx1_address` for
 * an order match (tx1 is the incoming order). Counting both sides of a book
 * match would make buys and sells identical by construction and destroy the
 * signal the panel exists to show.
 */
/** One executed fill, the atom the price series and its candles are made of. */
export interface PricePoint {
  block: number;
  /** Real Unix seconds (verbose=true), not derived from block distance. */
  time: number;
  /** XCP per whole token. XCP-69 mandates divisible, so both legs share the
   *  same 1e8 scale and the ratio needs no divisibility correction. */
  price: number;
  /** XCP that changed hands in this fill — the height of a volume bar. */
  volumeXcpRaw: Raw;
  venue: "pool" | "book";
}

/**
 * Every fill on the pair, both venues, oldest first.
 *
 * This replaces reading `/pools/{asset}/XCP/price_history`, which records one
 * snapshot per POOL RESERVE change. Orders here interleave between the pool
 * and the book, so a fill against resting orders never moves the reserves and
 * was therefore invisible to that feed — the chart was silently missing an
 * entire venue, at prices that genuinely traded.
 *
 * Building from fills also gives each point its own volume, which reserve
 * snapshots cannot carry.
 */
export async function fetchPriceSeries(
  asset: string,
  maxPages = 8,
): Promise<PricePoint[]> {
  const points: PricePoint[] = [];

  const walk = async <T extends { block_time: number }>(
    path: string,
    take: (m: T) => void,
  ) => {
    let cursor: number | null = null;
    let pages = 0;
    do {
      let page: Paginated<T>;
      try {
        page = await get(
          `${path}${path.includes("?") ? "&" : "?"}limit=200${cursor !== null ? `&cursor=${cursor}` : ""}`,
          60,
        );
      } catch {
        return;
      }
      for (const m of page.result) take(m);
      cursor = page.next_cursor;
      pages++;
    } while (cursor !== null && pages < maxPages);
  };

  const add = (
    block: number,
    time: number,
    xcpLeg: bigint,
    tokenLeg: bigint,
    venue: "pool" | "book",
  ) => {
    if (xcpLeg <= 0n || tokenLeg <= 0n) return;
    points.push({
      block,
      time,
      price: ratio(xcpLeg, tokenLeg),
      volumeXcpRaw: xcpLeg.toString(),
      venue,
    });
  };

  const encoded = encodeURIComponent(asset);
  await Promise.all([
    walk<PoolMatch & { block_index: number }>(
      `/pools/${encoded}/XCP/matches?verbose=true`,
      (m) => {
        if (m.status !== "valid") return;
        const sold = m.forward_asset === "XCP";
        add(
          m.block_index,
          m.block_time,
          big(sold ? m.forward_quantity : m.backward_quantity),
          big(sold ? m.backward_quantity : m.forward_quantity),
          "pool",
        );
      },
    ),
    walk<OrderMatch & { block_index: number }>(
      `/orders/${encoded}/XCP/matches?verbose=true&status=completed`,
      (m) => {
        const sold = m.forward_asset === "XCP";
        add(
          m.block_index,
          m.block_time,
          big(sold ? m.forward_quantity : m.backward_quantity),
          big(sold ? m.backward_quantity : m.forward_quantity),
          "book",
        );
      },
    ),
  ]);

  return points.sort((a, b) => a.time - b.time || a.block - b.block);
}

export type ActivityWindow = "24h" | "30d" | "all";

export interface PairActivity {
  "24h": PoolVolume;
  "30d": PoolVolume;
  all: PoolVolume;
}

interface Tally {
  volume: bigint;
  trades: number;
  buys: number;
  sells: number;
  buyVol: bigint;
  sellVol: bigint;
  buyers: Set<string>;
  sellers: Set<string>;
}
const emptyTally = (): Tally => ({
  volume: 0n,
  trades: 0,
  buys: 0,
  sells: 0,
  buyVol: 0n,
  sellVol: 0n,
  buyers: new Set(),
  sellers: new Set(),
});
const settle = (t: Tally): PoolVolume => ({
  volumeXcpRaw: t.volume.toString(),
  trades: t.trades,
  buys: t.buys,
  sells: t.sells,
  buyVolXcpRaw: t.buyVol.toString(),
  sellVolXcpRaw: t.sellVol.toString(),
  buyers: t.buyers.size,
  sellers: t.sellers.size,
});

/**
 * Trading across BOTH venues on the pair, bucketed into 24h, 30d and all-time.
 *
 * A single order here can fill against the pool and against resting orders in
 * the same execution — the two are interleaved, not alternatives — so counting
 * only pool matches undercounts real activity. Direction is always the
 * taker's: `source` for a pool fill, `tx1_address` for an order match. Counting
 * both sides of a book match would make buys and sells identical by
 * construction and destroy the signal.
 *
 * One pass fills all three windows. Fetching per-window would re-read the same
 * rows three times to answer three nested questions about them.
 */
export async function fetchPairActivity(
  asset: string,
  maxPages = 8,
): Promise<PairActivity> {
  const now = Math.floor(Date.now() / 1000);
  const dayCutoff = now - 86_400;
  const monthCutoff = now - 30 * 86_400;
  const windows = { "24h": emptyTally(), "30d": emptyTally(), all: emptyTally() };

  const record = (
    taker: string | undefined,
    soldTokens: boolean,
    xcpLeg: bigint,
    at: number,
    // A book fill's resting side. Counted as a trader on the opposite
    // direction — the maker whose sell the taker's buy crossed really did
    // sell — but never into the trade/volume tallies, which count fills.
    maker?: string,
  ) => {
    const targets: Tally[] = [windows.all];
    if (at >= monthCutoff) targets.push(windows["30d"]);
    if (at >= dayCutoff) targets.push(windows["24h"]);
    for (const t of targets) {
      t.volume += xcpLeg;
      t.trades++;
      if (soldTokens) {
        t.sells++;
        t.sellVol += xcpLeg;
        if (taker) t.sellers.add(taker);
        if (maker) t.buyers.add(maker);
      } else {
        t.buys++;
        t.buyVol += xcpLeg;
        if (taker) t.buyers.add(taker);
        if (maker) t.sellers.add(maker);
      }
    }
  };

  /** Walk one matches feed to exhaustion, bounded. Both are newest-first. */
  const walk = async <T extends { block_time: number }>(
    path: string,
    take: (m: T) => void,
  ) => {
    let cursor: number | null = null;
    let pages = 0;
    do {
      let page: Paginated<T>;
      try {
        page = await get(
          `${path}${path.includes("?") ? "&" : "?"}limit=200${cursor !== null ? `&cursor=${cursor}` : ""}`,
          60,
        );
      } catch {
        return;
      }
      for (const m of page.result) take(m);
      cursor = page.next_cursor;
      pages++;
    } while (cursor !== null && pages < maxPages);
  };

  const encoded = encodeURIComponent(asset);
  await Promise.all([
    walk<PoolMatch>(`/pools/${encoded}/XCP/matches?verbose=true`, (m) => {
      if (m.status !== "valid") return;
      const sold = m.forward_asset === "XCP";
      record(
        m.source,
        sold,
        big(sold ? m.forward_quantity : m.backward_quantity),
        m.block_time,
      );
    }),
    walk<OrderMatch>(
      `/orders/${encoded}/XCP/matches?verbose=true&status=completed`,
      (m) => {
        const sold = m.forward_asset === "XCP";
        record(
          m.tx1_address,
          sold,
          big(sold ? m.forward_quantity : m.backward_quantity),
          m.block_time,
          m.tx0_address !== m.tx1_address ? m.tx0_address : undefined,
        );
      },
    ),
  ]);

  return {
    "24h": settle(windows["24h"]),
    "30d": settle(windows["30d"]),
    all: settle(windows.all),
  };
}

interface MempoolFairminterEvent {
  tx_hash: string;
  // The mempool-time params shape is already field-for-field the same
  // record /fairminters returns once confirmed — Fairminter minus the
  // two fields that only exist once mints happen.
  params: Omit<Fairminter, "earned_quantity" | "paid_quantity" | "confirmed">;
}

export async function fetchMempoolFairminters(): Promise<Fairminter[]> {
  try {
    const data = await get<{ result: MempoolFairminterEvent[] }>(
      `/mempool/events/NEW_FAIRMINTER?limit=500`,
      0,
    );
    return data.result.map((e) => ({
      ...e.params,
      earned_quantity: null,
      paid_quantity: null,
    }));
  } catch {
    return [];
  }
}

/** Imported and re-exported, so this module stays the one import site callers
 *  know while the declaration itself lives where apps/api can reach it too —
 *  see @launchpad/xcp69/mempool. Both halves are needed: a bare `export ... from`
 *  would not put the name in scope for this file's own signatures. */
export type { MempoolMint };

interface MempoolFairmintEvent {
  tx_hash: string;
  params: {
    asset: string;
    source: string;
    earn_quantity: Raw | null;
    paid_quantity: Raw | null;
    status?: string;
    asset_info?: { divisible?: boolean } | null;
  };
}

/**
 * Unconfirmed mints across every launch.
 *
 * `earn_quantity` / `paid_quantity` are the per-MINT amounts here, not the
 * fairminter's running totals, so they are present on a real mint — but the
 * standard guard still applies (see the repo CLAUDE.md): a malformed or
 * invalid event can carry null, and null must never reach arithmetic. Those
 * rows are dropped rather than counted as zero, which would quietly
 * understate a total the page presents as exact.
 */
export async function fetchMempoolFairmints(): Promise<MempoolMint[]> {
  try {
    const data = await get<{ result: MempoolFairmintEvent[] }>(
      `/mempool/events/NEW_FAIRMINT?limit=500`,
      0,
    );
    return data.result
      .filter(
        (e) =>
          // An invalid mint is in the mempool but will never credit anyone.
          (e.params.status === undefined || e.params.status === "valid") &&
          e.params.earn_quantity !== null &&
          e.params.paid_quantity !== null,
      )
      .map((e) => ({
        txHash: e.tx_hash,
        asset: e.params.asset,
        source: e.params.source,
        earnQuantity: e.params.earn_quantity!,
        paidQuantity: e.params.paid_quantity!,
        divisible: e.params.asset_info?.divisible ?? true,
      }));
  } catch {
    return [];
  }
}

export async function fetchMempoolFairminter(
  asset: string,
): Promise<Fairminter | null> {
  const all = await fetchMempoolFairminters();
  return all.find((fm) => fm.asset === asset) ?? null;
}

/** Real Unix seconds for a block. Counterparty stores block_time; nothing
 *  here needs to guess at ten-minute averages. */
export async function fetchBlockTime(blockIndex: number): Promise<number | null> {
  try {
    const data = await get<{ result: { block_time?: number } | null }>(
      `/blocks/${blockIndex}`,
      3600,
    );
    return data.result?.block_time ?? null;
  } catch {
    return null;
  }
}

export async function fetchBlockHeight(): Promise<number> {
  const data = await get<{ result: { counterparty_height: number } }>("/", 30);
  return data.result.counterparty_height;
}
