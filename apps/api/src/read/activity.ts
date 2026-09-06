/**
 * /v2/activity/* — the sitewide tape.
 *
 * Separate feeds rather than one route returning every tape. The page
 * shows one tab at a time, and a combined response would make every visitor
 * pay for the three feeds they are not looking at — on a page built to be left
 * open. Separate URLs also means each feed keeps its own edge-cache entry and
 * its own honest TTL. Burns, mints, trades, launches and orders are local
 * indexed reads; only pool history comes from a public node.
 *
 * The wire shape is snake_case, like every other D1-backed route here. The
 * camelCase in /v2/mempool is a documented exception for rows handed straight
 * to React; these are columns, and the web client maps them the same way it
 * maps /v2/mints/by/:source.
 */
import type { Raw } from "@launchpad/xcp69/numeric";
import { fetchPoolEvents } from "#api/integrations/counterparty";
import { countOrders } from "#api/indexer/orders";
import {
  countTradesByAsset,
  getActivityTotals,
  listConformingAssetInfo,
  listRecentLaunches,
  listRecentBurns,
  listRecentMints,
  listRecentOrders,
  listRecentTrades,
} from "#api/queries/activity";
import { J, router, type Ctx } from "#api/read/respond";

export const activityRoute = router();

/** A tape page. Larger than the launch index's 24 because a feed is read by
 *  scrolling, not by paging, and the client asks once per tab. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Deep enough to scroll back through a busy week, shallow enough that a
 *  crafted offset cannot ask SQLite to walk and discard an absurd number of
 *  rows — the same bound every other paged route here uses. */
const MAX_OFFSET = 100_000;

/** These three are folded by the indexer, which runs on a five-minute cron and
 *  again the moment a mint leaves the mempool. Nothing here can be fresher
 *  than that, so a shorter TTL would only re-serve the same answer more often;
 *  30s keeps a watched page responsive without pretending otherwise. */
const INDEXED_TTL = 30;
/** The book is read live from a public Counterparty node, one request per
 *  traded asset per miss. Orders rest for blocks at a time, so a minute of edge
 *  cache costs the reader nothing and is the difference between one upstream
 *  fan-out per colo per minute and one per visitor. */
const ORDERS_TTL = 60;

/** The three feeds that describe a pool's life. Swaps are deliberately absent:
 *  POOL_MATCH is a trade, it is already the `pool` half of the trades tape, and
 *  repeating it here would make this tab a second copy of that one rather than
 *  the thing it exists to show — where the liquidity itself came from and went. */
const POOL_EVENTS = ["OPEN_POOL", "NEW_POOL_DEPOSIT", "NEW_POOL_WITHDRAWAL"] as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

function paging(c: Ctx) {
  return {
    limit: clamp(Number(c.req.query("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clamp(Number(c.req.query("offset") ?? 0) || 0, 0, MAX_OFFSET),
  };
}

/** `next_offset` is null on a short page, which is the client's signal that it
 *  reached the end — the same contract /v2/mints/by/:source uses. */
const page = <T>(rows: T[], limit: number, offset: number) => ({
  result: rows,
  result_count: rows.length,
  next_offset: rows.length === limit ? offset + limit : null,
});

/** The tab labels' counts. Its own route so the tapes stay one-per-tab: this
 *  is the only read the page makes that is not about the tab in front of you,
 *  and it is one row. */
activityRoute.get("/v2/activity/totals", async (c) => {
  const result = await getActivityTotals(c.env.DB);
  return J(c, { result }, INDEXED_TTL);
});

activityRoute.get("/v2/activity/mints", async (c) => {
  const { limit, offset } = paging(c);
  const rows = await listRecentMints(c.env.DB, limit, offset);
  return J(c, page(rows, limit, offset), INDEXED_TTL);
});

activityRoute.get("/v2/activity/trades", async (c) => {
  const { limit, offset } = paging(c);
  const asset = c.req.query("asset")?.trim().toUpperCase() || undefined;
  const [rows, total] = await Promise.all([
    listRecentTrades(c.env.DB, limit, offset, asset),
    asset ? countTradesByAsset(c.env.DB, asset) : Promise.resolve(null),
  ]);
  return J(c, { ...page(rows, limit, offset), ...(total === null ? {} : { total }) }, INDEXED_TTL);
});

activityRoute.get("/v2/activity/burns", async (c) => {
  const { limit, offset } = paging(c);
  const rows = await listRecentBurns(c.env.DB, limit, offset);
  return J(c, page(rows, limit, offset), INDEXED_TTL);
});

activityRoute.get("/v2/activity/launches", async (c) => {
  const { limit, offset } = paging(c);
  const rows = await listRecentLaunches(c.env.DB, limit, offset);
  return J(c, page(rows, limit, offset), INDEXED_TTL);
});

/** The states an order can be in. Counterparty has four; `partial` is derived
 *  here because "open, but partly taken" is the state a reader most needs to
 *  see and the one the protocol does not name. */
type OrderState = "open" | "partial" | "filled" | "cancelled" | "expired";

/** Raw quantities are TEXT in D1 and can exceed 2^53, so the fill fraction is
 *  computed in bigint and only becomes a double at the end. */
function rawInt(value: string): bigint | null {
  return /^-?\d+$/.test(value) ? BigInt(value) : null;
}

/** Fraction of the GIVE leg already taken — the leg the maker is parting with,
 *  which is the token on an ask and XCP on a bid. An unreadable quantity
 *  yields 0 rather than a guess: the row still renders, just without a meter. */
function filledFraction(quantity: string, remaining: string): number {
  const total = rawInt(quantity);
  const left = rawInt(remaining);
  if (total === null || left === null || total <= 0n) return 0;
  const taken = total - (left < 0n ? 0n : left);
  if (taken <= 0n) return 0;
  if (taken >= total) return 1;
  return Number((taken * 10_000n) / total) / 10_000;
}

function orderState(status: string, filled: number): OrderState {
  if (status === "filled") return "filled";
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "expired";
  return filled > 0 ? "partial" : "open";
}

/**
 * The order book across every XCP-69 market, newest first, in every state.
 *
 * Answered from D1 since migration 0022. It used to be the one route on this
 * page that fanned out to Counterparty — one subrequest per graduated market
 * per edge-cache miss, a cost that grew with the site's success — and that is
 * now the indexer's problem, where it is gated by a digest and usually costs
 * nothing at all. See src/indexer/orders.ts.
 *
 * `live=1` narrows to orders still resting on the book. Filtering here and not
 * in the browser is the point: the newest fifty orders on a busy pair are
 * mostly finished ones, so a client-side filter over one page would answer
 * "show me the live book" with whatever handful survived that page. It is also
 * a separate URL and a separate index, so the two answers neither share an
 * edge-cache entry nor the same query plan.
 */
activityRoute.get("/v2/activity/orders", async (c) => {
  const live = c.req.query("live") === "1";
  const { limit, offset } = paging(c);
  const [rows, counted] = await Promise.all([
    listRecentOrders(c.env.DB, live, limit, offset),
    countOrders(c.env.DB, live),
  ]);

  const total = counted?.n ?? rows.length;
  const result = rows.map((o) => {
    // The give leg is the token on an ask and XCP on a bid.
    const filled =
      o.side === "sell"
        ? filledFraction(o.token_quantity, o.token_remaining)
        : filledFraction(o.xcp_quantity, o.xcp_remaining);
    return {
      tx_hash: o.tx_hash,
      source: o.source,
      asset: o.asset,
      side: o.side === "sell" ? "sell" : "buy",
      state: orderState(o.status, filled),
      block_index: o.block_index,
      expire_index: o.expire_index,
      token_quantity: o.token_quantity,
      xcp_quantity: o.xcp_quantity,
      token_remaining: o.token_remaining,
      xcp_remaining: o.xcp_remaining,
      filled,
      divisible: o.divisible,
    };
  });

  return J(
    c,
    {
      result,
      result_count: result.length,
      total,
      next_offset: offset + limit < total ? offset + limit : null,
    },
    INDEXED_TTL,
  );
});

type PoolEventKind = "created" | "deposit" | "withdraw";

interface PoolEventRow {
  tx_hash: string;
  event_index: number;
  kind: PoolEventKind;
  block_index: number;
  source: string;
  /** The XCP-69 side — the asset this row is about. */
  asset: string;
  asset_divisible: number;
  asset_quantity: Raw;
  /** The other half of the pair. "XCP" for every pool a graduation opens, but
   *  not always: two launch tokens can be pooled against each other, and that
   *  is real activity on both of them. */
  counter_asset: string;
  counter_divisible: number;
  counter_quantity: Raw;
  /** LP minted (created, deposit) or destroyed (withdraw). */
  lp_quantity: Raw | null;
  /** True when this is the pool the protocol opened at graduation, identified
   *  by the launch's own recorded lp_asset rather than guessed from the shape
   *  of the event. That pool's LP was minted to the unspendable address, so
   *  its liquidity is locked forever — which is the single most important
   *  thing a reader can know about a row in this tape. */
  graduation: boolean;
}

/** Raw quantities arrive as a JSON number or, above 2^53, a lossless string. */
const rawOr0 = (v: number | string | undefined): Raw => (v === undefined ? "0" : v);

/**
 * Where the liquidity came from and where it went.
 *
 * The trades tape answers what a pool DID; this answers what it IS made of —
 * the graduation that opened it, and every hand that has added to or taken
 * from it since. XCP-69's own pools are opened with their LP minted straight
 * to the unspendable address, so the liquidity a launch graduates with can
 * never leave; anything anyone deposits on top of that can, and this is the
 * tape where that difference is visible.
 *
 * Three chain-wide requests, not a per-market fan-out. These feeds are tens of
 * events in total across all of Counterparty — a pool opens when a launch
 * graduates and is otherwise touched by hand — so unlike the order book this
 * costs the same whether the site has three markets or three hundred.
 */
activityRoute.get("/v2/activity/pools", async (c) => {
  const [feeds, covered] = await Promise.all([
    Promise.all(POOL_EVENTS.map((name) => fetchPoolEvents(name).catch(() => null))),
    listConformingAssetInfo(c.env.DB),
  ]);
  if (feeds.every((f) => f === null)) {
    return c.json({ error: "pool history unavailable" }, 503);
  }

  const info = new Map(covered.map((a) => [a.asset, a]));
  // Every lp_asset this site's launches minted, so a pool opened by hand on one
  // of our assets is never mislabelled as a graduation.
  const graduationLp = new Set(
    covered.map((a) => a.lp_asset).filter((lp): lp is string => Boolean(lp)),
  );

  const rows: PoolEventRow[] = [];
  feeds.forEach((feed, i) => {
    if (!feed) return;
    const name = POOL_EVENTS[i]!;
    const kind: PoolEventKind =
      name === "OPEN_POOL" ? "created" : name === "NEW_POOL_DEPOSIT" ? "deposit" : "withdraw";

    for (const e of feed) {
      const p = e.params;
      // OPEN_POOL carries no status; the other two must be valid.
      if (p.status !== undefined && p.status !== "valid") continue;

      // Which half is ours. XCP is never ours, so a TOKEN/XCP pool resolves
      // immediately; a TOKEN/TOKEN pool between two launches is reported
      // against asset_a, which is the side Counterparty itself names first.
      const aMine = info.has(p.asset_a);
      const bMine = info.has(p.asset_b);
      if (!aMine && !bMine) continue;
      const flip = !aMine;

      const asset = flip ? p.asset_b : p.asset_a;
      const counter = flip ? p.asset_a : p.asset_b;
      const mine = info.get(asset)!;
      const open = kind === "created";
      const qa = rawOr0(open ? p.reserve_a : p.quantity_a);
      const qb = rawOr0(open ? p.reserve_b : p.quantity_b);

      rows.push({
        tx_hash: p.tx_hash,
        event_index: e.event_index,
        kind,
        block_index: e.block_index,
        source: p.source,
        asset,
        asset_divisible: mine.divisible,
        asset_quantity: flip ? qb : qa,
        counter_asset: counter,
        // XCP is divisible; a launch token answers from D1; anything else on
        // the chain is assumed divisible, which is the common case and only
        // affects a decimal point on a counter amount.
        counter_divisible: counter === "XCP" ? 1 : (info.get(counter)?.divisible ?? 1),
        counter_quantity: flip ? qa : qb,
        lp_quantity: open
          ? null
          : kind === "deposit"
            ? rawOr0(p.quantity_minted)
            : rawOr0(p.quantity_destroyed),
        graduation: open && Boolean(p.lp_asset) && graduationLp.has(p.lp_asset!),
      });
    }
  });

  // A pool opening is reported TWICE: OPEN_POOL for the pool, and a
  // NEW_POOL_DEPOSIT for the liquidity that opened it, in the same
  // transaction. To a reader that is one event, and printing it as two makes
  // every graduation look like somebody immediately doubled the pool. So the
  // seed deposit folds into the created row — which is also the only place the
  // created row can get an LP quantity, since OPEN_POOL does not carry one.
  //
  // Matched on transaction AND asset, not transaction alone: nothing stops one
  // transaction from opening more than one pool.
  const seedKey = (r: PoolEventRow) => `${r.tx_hash}:${r.asset}`;
  const openedBy = new Set(rows.filter((r) => r.kind === "created").map(seedKey));
  const seeds = new Map(
    rows.filter((r) => r.kind === "deposit").map((r) => [seedKey(r), r] as const),
  );
  for (const r of rows) {
    if (r.kind === "created") r.lp_quantity = seeds.get(seedKey(r))?.lp_quantity ?? null;
  }
  const merged = rows.filter((r) => !(r.kind === "deposit" && openedBy.has(seedKey(r))));

  // One chronology out of three feeds. event_index is Counterparty's own total
  // order over everything that has ever happened, so it breaks a block tie
  // exactly the way the chain does and keeps paging stable between requests.
  merged.sort((a, b) => b.block_index - a.block_index || b.event_index - a.event_index);

  const { limit, offset } = paging(c);
  const slice = merged.slice(offset, offset + limit);
  return J(
    c,
    {
      result: slice,
      result_count: slice.length,
      total: merged.length,
      feeds_read: feeds.filter(Boolean).length,
      next_offset: offset + limit < merged.length ? offset + limit : null,
    },
    ORDERS_TTL,
  );
});
