/**
 * The only module in this worker allowed to call the Counterparty API. The
 * poller reads through here; every read route answers from D1.
 */
import { parseJsonLossless, rawEquals, SATS_PER_UNIT } from "@launchpad/xcp69/numeric";
import type { MempoolMint, MempoolOrder } from "@launchpad/xcp69/mempool";
import type { CounterpartyEvent } from "@launchpad/xcp69/trades";

const BASE = "https://api.counterparty.io:4000/v2";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Counterparty ${path} -> HTTP ${res.status}`);
  // Native res.json() rounds integers past 2^53 — exactly what XCP-69's 1e16
  // hard cap sits above. Parse losslessly so unsafe magnitudes survive as
  // strings instead of silently drifting, the same way the web app does.
  return parseJsonLossless<T>(await res.text());
}

export interface CpFairminter {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  source: string;
  asset: string;
  asset_longname: string | null;
  description: string;
  price: number | string;
  quantity_by_price: number | string;
  hard_cap: number | string;
  soft_cap: number | string;
  soft_cap_deadline_block: number;
  start_block: number;
  end_block: number;
  burn_payment: boolean;
  max_mint_per_tx: number | string;
  max_mint_per_address: number | string | null;
  /** Core 11.3+ display companion; raw value above remains the indexed source of truth. */
  max_mint_per_address_normalized?: string | null;
  premint_quantity: number | string;
  minted_asset_commission_int: number | string | null;
  lock_description: boolean;
  lock_quantity: boolean;
  divisible: boolean;
  pool_quantity: number | string | null;
  /** Core 11.3+ display companion; intentionally not persisted for conformance math. */
  pool_quantity_normalized?: string | null;
  lp_asset: string | null;
  status: string;
  earned_quantity: number | string | null;
  paid_quantity: number | string | null;
}

/** Every fairminter on the chain, paginated to exhaustion — never a fixed
 *  page count, per the project's standing rule on Counterparty pagination. */
export async function fetchAllFairminters(): Promise<CpFairminter[]> {
  const rows: CpFairminter[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 50; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    const data: { result: CpFairminter[]; next_cursor: number | null } =
      await get(`/fairminters?limit=500&verbose=true${qs}`);
    rows.push(...data.result);
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

/** Mempool shapes. `params` is field-for-field the record /fairminters
 *  returns once confirmed, minus the two fields that only exist once mints
 *  happen — the same equivalence the web app relies on. */
interface MempoolFairminterEvent {
  tx_hash: string;
  params: Omit<CpFairminter, "earned_quantity" | "paid_quantity">;
}

interface MempoolFairmintEvent {
  tx_hash: string;
  params: {
    asset: string;
    source: string;
    earn_quantity: number | string | null;
    paid_quantity: number | string | null;
    status?: string;
    asset_info?: { divisible?: boolean } | null;
  };
}

interface MempoolOrderEvent {
  tx_hash: string;
  params: {
    source: string;
    give_asset: string;
    get_asset: string;
    give_quantity: number | string;
    get_quantity: number | string;
    status?: string;
  };
}

export type { MempoolMint, MempoolOrder } from "@launchpad/xcp69/mempool";

/** Unconfirmed launches. Empty on any failure: the mempool is a nice-to-have
 *  signal, and a Counterparty hiccup should leave the header chip absent, not
 *  the page broken. */
export async function fetchMempoolFairminters(): Promise<CpFairminter[]> {
  try {
    const data = await get<{ result: MempoolFairminterEvent[] }>(
      `/mempool/events/NEW_FAIRMINTER?limit=500`,
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

/**
 * Unconfirmed mints across every launch.
 *
 * `earn_quantity` / `paid_quantity` are per-MINT amounts here, not the
 * fairminter's running totals, so they are present on a real mint — but the
 * standing guard still applies: a malformed or invalid event can carry null,
 * and null must never reach arithmetic. Those rows are dropped rather than
 * counted as zero, which would quietly understate a total the page presents as
 * exact.
 */
export async function fetchMempoolFairmints(): Promise<MempoolMint[]> {
  try {
    const data = await get<{ result: MempoolFairmintEvent[] }>(
      `/mempool/events/NEW_FAIRMINT?limit=500`,
    );
    return data.result
      .filter(
        (e) =>
          // An invalid mint sits in the mempool but will never credit anyone.
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

/** Unconfirmed order-book offers. Pair filtering belongs in /v2/mempool,
 * where the conforming asset set is available. */
export async function fetchMempoolOrders(): Promise<MempoolOrder[]> {
  try {
    const data = await get<{ result: MempoolOrderEvent[] }>(
      `/mempool/events/OPEN_ORDER?limit=500`,
    );
    return data.result
      .filter((e) => e.params.status === undefined || e.params.status === "open")
      .map((e) => ({
        txHash: e.tx_hash,
        source: e.params.source,
        // Resolved after the covered-set check in the route.
        asset: e.params.give_asset === "XCP" ? e.params.get_asset : e.params.give_asset,
        giveAsset: e.params.give_asset,
        getAsset: e.params.get_asset,
        giveQuantity: e.params.give_quantity,
        getQuantity: e.params.get_quantity,
      }));
  } catch {
    return [];
  }
}

/** One order on a pair's book, in any state. Non-verbose: the fields the
 *  activity tape needs are all in the plain row, and asset divisibility is
 *  answered from D1 rather than from `*_asset_divisible` so one database
 *  decides how a quantity is scaled. */
export interface CpOrder {
  tx_hash: string;
  tx_index: number;
  block_index: number;
  source: string;
  give_asset: string;
  give_quantity: number | string;
  give_remaining: number | string;
  get_asset: string;
  get_quantity: number | string;
  get_remaining: number | string;
  expire_index: number;
  /** `open`, `filled`, `cancelled` or `expired`. Counterparty has no
   *  "partially filled" status — that is an open order whose remaining is
   *  below its original, and the tape derives it. */
  status: string;
}

/** Runaway bound, not a page budget — see fetchMatches. A single pair's whole
 *  order history is tens of rows today; this is far above any real one. */
const MAX_ORDER_PAGES = 20;

/**
 * Every order ever placed on one asset, in any state, newest first.
 *
 * Per-asset rather than chain-wide, and that is forced rather than chosen.
 * `/orders` unfiltered is 566,000 rows — 260,000 filled, 216,000 expired —
 * so there is no page budget at which a chain-wide walk both terminates and
 * tells the truth. Filtering it to `status=open` was tractable (about four
 * pages) but can only ever show the live book, which is half the question:
 * an order that filled is the more interesting event.
 *
 * Asked per asset, the same question is small. This site knows exactly which
 * assets have a market — the caller passes them — and each one's entire order
 * history arrives in one request.
 *
 * Failures throw. An empty book and a failed lookup must not be the same
 * answer; the caller decides what to do with a pair it could not read.
 */
export async function fetchAssetOrders(asset: string): Promise<CpOrder[]> {
  const rows: CpOrder[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    const data: { result: CpOrder[]; next_cursor: number | null } = await get(
      `/assets/${encodeURIComponent(asset)}/orders?limit=500${qs}`,
    );
    rows.push(...data.result);
    cursor = data.next_cursor;
    if (!cursor) return rows;
  }
  throw new Error(`order history truncated after ${MAX_ORDER_PAGES} pages: ${asset}`);
}

/**
 * A pool's lifecycle, as Counterparty reports it.
 *
 * `params` differs by event: OPEN_POOL names the opening reserves and the LP
 * asset it minted, while a deposit or withdrawal names the quantities moved
 * and the LP minted or destroyed against them. One interface with optional
 * halves rather than three, because the route normalises all three into one
 * row anyway and three shapes would only move that branch upstream.
 */
export interface CpPoolEvent {
  event: string;
  event_index: number;
  block_index: number;
  params: {
    asset_a: string;
    asset_b: string;
    source: string;
    tx_hash: string;
    /** Absent on OPEN_POOL, which cannot be invalid — the pool either opened
     *  or the event was never written. */
    status?: string;
    lp_asset?: string;
    reserve_a?: number | string;
    reserve_b?: number | string;
    quantity_a?: number | string;
    quantity_b?: number | string;
    quantity_minted?: number | string;
    quantity_destroyed?: number | string;
  };
}

/** Runaway bound, not a page budget. Chain-wide these three feeds are tens of
 *  events in total — a pool opens when a launch graduates and is otherwise
 *  touched by hand — so this is orders of magnitude above any real history. */
const MAX_POOL_EVENT_PAGES = 20;

/**
 * Pool creations, deposits and withdrawals across the whole chain, newest
 * first, unfiltered.
 *
 * Chain-wide and NOT per-asset, which is the opposite of how the order book
 * has to be read — and for the opposite reason. Orders are half a million
 * rows, so they can only be asked for one market at a time; these are counted
 * in tens, so one request per event type answers for every launch at once and
 * costs nothing extra as the site grows. The covered-set filter runs in the
 * route, where D1 is.
 *
 * A failed feed throws rather than returning what it had: a partial history
 * here is indistinguishable from a quiet one, and the caller decides.
 */
export async function fetchPoolEvents(name: string): Promise<CpPoolEvent[]> {
  const rows: CpPoolEvent[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < MAX_POOL_EVENT_PAGES; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    const data: { result: CpPoolEvent[]; next_cursor: number | null } = await get(
      `/events/${name}?limit=500${qs}`,
    );
    rows.push(...(data.result ?? []));
    cursor = data.next_cursor;
    if (!cursor) return rows;
  }
  throw new Error(`pool event feed truncated after ${MAX_POOL_EVENT_PAGES} pages: ${name}`);
}

/** One fairminter by tx_hash — O(1), for the live room's poll tick. Never
 *  used by the main indexer pass, which already has every row from the
 *  bulk listing; this is only for the single asset someone is watching. */
export async function fetchFairminter(txHash: string): Promise<CpFairminter | null> {
  try {
    const data: { result: CpFairminter | null } = await get(
      `/fairminters/${txHash}?verbose=true`,
    );
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function fetchBlockHeight(): Promise<number> {
  const data: { result: { counterparty_height: number } } = await get("/");
  return data.result.counterparty_height;
}

export interface CpAddressReceive {
  tx_index: number;
  tx_hash: string;
  block_index: number;
  source: string;
  destination: string;
  asset: string;
  quantity: number | string;
  status: string;
  msg_index: number;
}

export interface CpAddressReceivePage {
  result: CpAddressReceive[];
  next_cursor: number | null;
}

/**
 * Sends received by one address, newest first.
 *
 * The burn monitor uses this address-scoped route instead of polling the
 * chain-wide SEND event tables. That keeps a quiet tick to one tiny response
 * no matter how large Counterparty's send history becomes.
 */
export function fetchAddressReceives(
  address: string,
  limit: number,
  cursor?: number,
): Promise<CpAddressReceivePage> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) qs.set("cursor", String(cursor));
  return get<CpAddressReceivePage>(
    `/addresses/${encodeURIComponent(address)}/receives?${qs.toString()}`,
  );
}

export interface CpAssetBalance {
  address: string | null;
  utxo_address?: string | null;
  quantity: number | string;
}

export interface CpAssetDispenser {
  source: string;
  origin?: string | null;
  status: number;
  dispense_count: number;
}

/** Full current holder list for one selected launch. This is cron-only: the
 * public dashboard reads the aggregate D1 row produced from it. */
export async function fetchAssetBalances(asset: string): Promise<CpAssetBalance[]> {
  const rows: CpAssetBalance[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 20; page++) {
    const qs: string = cursor === null ? "" : `&cursor=${cursor}`;
    const data: {
      result: CpAssetBalance[];
      next_cursor: number | null;
    } = await get(`/assets/${encodeURIComponent(asset)}/balances?limit=1000${qs}`);
    rows.push(...data.result);
    cursor = data.next_cursor;
    if (cursor === null) break;
  }
  return rows;
}

/** Dispensers are a separate sale route from pools and orders. The launch
 * worklist is at most ten assets, so reading by asset is bounded and avoids
 * the six-figure global dispenser event stream. */
export async function fetchAssetDispensers(asset: string): Promise<CpAssetDispenser[]> {
  const rows: CpAssetDispenser[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 20; page++) {
    const qs: string = cursor === null ? "" : `&cursor=${cursor}`;
    const data: {
      result: CpAssetDispenser[];
      next_cursor: number | null;
    } = await get(`/assets/${encodeURIComponent(asset)}/dispensers?limit=1000&verbose=true${qs}`);
    rows.push(...data.result);
    cursor = data.next_cursor;
    if (cursor === null) break;
  }
  return rows;
}

/** Unix time for one confirmed block. Used only by write-once historical
 * facts, never by a read route. A missing block is retryable, not time zero. */
export async function fetchBlockTime(blockIndex: number): Promise<number | null> {
  try {
    const data: { result: { block_time?: number } | null } = await get(
      `/blocks/${blockIndex}`,
    );
    const value = data.result?.block_time;
    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The append-only creation event. Its own block_index is when the
 *  announcement confirmed — the one fact the /fairminters row stops being
 *  able to answer once a launch has opened. */
export async function fetchAnnounceFacts(
  txHash: string,
): Promise<{ announceBlock: number | null; originalDeadline: number | null }> {
  const data: {
    result: { block_index: number; params: { soft_cap_deadline_block: number } }[];
  } = await get(`/transactions/${txHash}/events/NEW_FAIRMINTER`);
  const event = data.result?.[0];
  return {
    announceBlock: event?.block_index ?? null,
    originalDeadline: event?.params?.soft_cap_deadline_block ?? null,
  };
}

export interface CpFairmint {
  tx_hash: string;
  /** Counterparty's global transaction counter, which is what orders two
   *  mints that landed in the SAME block — block_index alone cannot. Read for
   *  the crown's tiebreak; see migration 0013. */
  tx_index: number;
  block_index: number;
  source: string;
  earn_quantity: number | string;
  paid_quantity: number | string;
}

/** All mints for one fairminter, paginated to exhaustion. */
export async function fetchFairmints(fairminterTx: string): Promise<CpFairmint[]> {
  const rows: CpFairmint[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 50; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    const data: { result: CpFairmint[]; next_cursor: number | null } = await get(
      `/fairminters/${fairminterTx}/fairmints?limit=500${qs}`,
    );
    rows.push(...data.result);
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

export interface CpPool {
  asset_a: string;
  asset_b: string;
  reserve_a: number | string;
  reserve_b: number | string;
}

/**
 * A pool lookup that says whether it actually got an answer.
 *
 * The distinction is load-bearing, and collapsing it cost a launch its status. This is the
 * launched-versus-refunded oracle: no pool means the sale failed and the XCP went back. So a
 * `fetchPool` that returned null on a timeout was reporting "this launch refunded" every time the
 * node was slow — and SEISMONSTER, which had graduated with 529 XCP in its pool, was rewritten as
 * refunded and vanished from the site.
 *
 * A pool that does not exist answers 404. Anything else — a timeout, a 429, a 503 — is the node
 * declining to say, which is not the same as saying no. Only the first is an answer.
 */
export type PoolLookup = { known: true; pool: CpPool | null } | { known: false };

export async function fetchPool(asset: string): Promise<PoolLookup> {
  const path = `/pools/${encodeURIComponent(asset)}/XCP?verbose=true`;
  try {
    const data: { result: CpPool | null } = await get(path);
    return { known: true, pool: data.result ?? null };
  } catch (error) {
    // 404 is the node telling us there is no such pool, which is exactly the fact being asked
    // for. Every other failure leaves the question open.
    if (error instanceof Error && error.message.endsWith("HTTP 404")) {
      return { known: true, pool: null };
    }
    return { known: false };
  }
}

export interface CpDispenser {
  tx_hash: string;
  give_quantity: number | string;
  give_remaining: number | string;
  satoshirate: number | string;
}

export interface CpPendingXcpDispense {
  dispenser_tx_hash: string;
  dispense_quantity: number | string;
}

/**
 * Open XCP dispensers, cheapest first — the book the project marks XCP at.
 *
 * Mirrors the web app's `fetchXcpDispensers` deliberately: the same filters
 * (no oracle-priced rows, 1 XCP per vend) so the alert quotes the same ask the
 * site prints. One page is enough because only the head of the book is ever
 * read; the standing pagination rule is about exhausting a listing you intend
 * to index, and this indexes nothing.
 */
export async function fetchXcpDispensers(): Promise<CpDispenser[]> {
  try {
    const data: { result: CpDispenser[] } = await get(
      `/assets/XCP/dispensers?status=open&exclude_with_oracle=true&sort=price:asc&limit=100`,
    );
    // rawEquals, not `=== 1e8`: give_quantity arrives as a raw integer that
    // may have come through parseJsonLossless as a string, and coercing money
    // to a double to compare it is the one thing this repo does not do.
    return (data.result ?? []).filter((d) => rawEquals(d.give_quantity, SATS_PER_UNIT));
  } catch {
    return [];
  }
}

/** Pending XCP fills used to project dispenser escrow through the mempool. */
export async function fetchPendingXcpDispenses(): Promise<CpPendingXcpDispense[]> {
  try {
    const data: { result: { params?: Partial<CpPendingXcpDispense> }[] } = await get(
      `/mempool/events/DISPENSE?limit=500`,
    );
    return (data.result ?? [])
      .map((event) => event.params)
      .filter(
        (params): params is CpPendingXcpDispense =>
          typeof params?.dispenser_tx_hash === "string" &&
          (typeof params.dispense_quantity === "number" ||
            typeof params.dispense_quantity === "string"),
      );
  } catch {
    return [];
  }
}

/** A filled trade against a TOKEN/XCP pair, either side. Both legs arrive in
 *  one row, which is what makes this cheap: the XCP amount never has to be
 *  chased through a separate, chain-wide feed. */
export interface CpMatch {
  [key: string]: unknown;
  id?: string;
  tx_hash?: string;
  tx_index?: number;
  tx1_hash?: string;
  tx1_index?: number;
  block_index: number;
  /** Pool match: the trader. The pool itself is the counterparty. */
  source?: string;
  /** Order match: `forward_asset` is what THIS address gets (order.py:697). */
  tx1_address?: string;
  /** Order match: the other side, who gets `backward_asset`. */
  tx0_address?: string;
  forward_asset: string;
  forward_quantity: number | string;
  backward_asset: string;
  backward_quantity: number | string;
  /** Real Unix seconds — the bucket a candle folds this fill into. */
  block_time?: number;
}

/**
 * Pool and order-book fills for one asset against XCP, newest first, stopping
 * as soon as a page reaches `sinceBlock`.
 *
 * Counterparty has no "since" filter, but it does return these in descending
 * block order, so an asset that hasn't traded since the last pass costs one
 * page and nothing else. `>=` rather than `>`: several fills can share the
 * boundary block, and the caller's INSERT OR IGNORE makes re-reading that one
 * block free.
 *
 * A mid-walk failure THROWS rather than returning what it had. This used to
 * `break` — which handed the caller a partial list indistinguishable from a
 * complete one, and the caller's high-water cursor then advanced past fills
 * the failed feed never delivered. Those fills became permanently
 * unreachable: the book probe only fires on strictly-newer matches, and the
 * candle fold's lastBlock guard would drop them even after a manual cursor
 * reset. An error must look like an error. The page cap exists only as a
 * runaway bound — far above any real pair's history — and hitting it is the
 * same lie a failed page was, so it throws too.
 */
const MAX_MATCH_PAGES = 200;

async function fetchMatches(path: string, sinceBlock: number): Promise<CpMatch[]> {
  const rows: CpMatch[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < MAX_MATCH_PAGES; page++) {
    const qs = cursor ? `&cursor=${cursor}` : "";
    const data: { result: CpMatch[]; next_cursor: number | null } = await get(
      `${path}${path.includes("?") ? "&" : "?"}limit=500${qs}`,
    );
    rows.push(...data.result);
    // Descending order means the oldest row on this page bounds the page: once
    // it is at or below what we already have, nothing older can be new.
    const oldest = data.result[data.result.length - 1];
    if (!oldest || oldest.block_index < sinceBlock) {
      return rows.filter((r) => r.block_index >= sinceBlock);
    }
    cursor = data.next_cursor;
    if (!cursor) return rows.filter((r) => r.block_index >= sinceBlock);
  }
  throw new Error(`match feed truncated after ${MAX_MATCH_PAGES} pages: ${path}`);
}

export function fetchPoolMatches(asset: string, sinceBlock: number): Promise<CpMatch[]> {
  return fetchMatches(`/pools/${encodeURIComponent(asset)}/XCP/matches?verbose=true`, sinceBlock);
}

export function fetchOrderMatches(asset: string, sinceBlock: number): Promise<CpMatch[]> {
  return fetchMatches(
    `/orders/${encodeURIComponent(asset)}/XCP/matches?status=completed&verbose=true`,
    sinceBlock,
  );
}

/**
 * The newest completed book match's block, or null when the pair has never
 * traded on the book (or the probe failed — the caller treats both as "no
 * news", and the next tick asks again).
 *
 * This is the cheap question behind the indexer's gate: a fill between two
 * resting orders moves no pool reserve, so the reserve check alone left book
 * fills unindexed until the next pool swap happened to force a pass. Same
 * feed and same descending-order guarantee `fetchMatches` already relies on;
 * one request, one row, no verbose.
 */
export async function fetchNewestOrderMatchBlock(asset: string): Promise<number | null> {
  try {
    const data: { result: CpMatch[] } = await get(
      `/orders/${encodeURIComponent(asset)}/XCP/matches?status=completed&limit=1`,
    );
    return data.result?.[0]?.block_index ?? null;
  } catch {
    return null;
  }
}

/** Exact message order for the rare transaction that crosses more than one
 * venue or price level. Match listings omit event_index, so callers only use
 * this immutable transaction-local list when a transaction is ambiguous. */
export async function fetchTransactionEvents(txHash: string): Promise<CounterpartyEvent[]> {
  const data: { result: CounterpartyEvent[] } = await get(
    `/transactions/${encodeURIComponent(txHash)}/events?limit=1000`,
  );
  return data.result ?? [];
}
