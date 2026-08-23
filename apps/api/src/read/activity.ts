/**
 * /v2/activity/* — the sitewide tape.
 *
 * Four feeds, four routes, rather than one route returning all four. The page
 * shows one tab at a time, and a combined response would make every visitor
 * pay for the three feeds they are not looking at — on a page built to be left
 * open. Separate URLs also means each feed keeps its own edge-cache entry and
 * its own honest TTL: three of these are as fresh as the indexer, and the
 * fourth is someone else's public node.
 *
 * The wire shape is snake_case, like every other D1-backed route here. The
 * camelCase in /v2/mempool is a documented exception for rows handed straight
 * to React; these are columns, and the web client maps them the same way it
 * maps /v2/mints/by/:source.
 */
import type { Raw } from "@launchpad/xcp69/numeric";
import { fetchAssetOrders } from "#api/integrations/counterparty";
import {
  countMarketAssets,
  getActivityTotals,
  listMarketAssets,
  listRecentLaunches,
  listRecentMints,
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

/** Ceiling on the order fan-out: one subrequest per asset, and a Worker has a
 *  hard subrequest limit. Deepest pools are read first, and the response says
 *  how many markets exist versus how many were read, so a truncated book is
 *  visible rather than silently presented as the whole one. */
const MAX_ORDER_ASSETS = 24;

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
  const rows = await listRecentTrades(c.env.DB, limit, offset);
  return J(c, page(rows, limit, offset), INDEXED_TTL);
});

activityRoute.get("/v2/activity/launches", async (c) => {
  const { limit, offset } = paging(c);
  const rows = await listRecentLaunches(c.env.DB, limit, offset);
  return J(c, page(rows, limit, offset), INDEXED_TTL);
});

/** The states an order can be in. Counterparty has four; `partial` is derived
 *  here because "open, but someone has already taken part of it" is the state
 *  a reader most needs to see and the one the protocol does not name. */
type OrderState = "open" | "partial" | "filled" | "cancelled" | "expired";

interface OrderRow {
  tx_hash: string;
  source: string;
  asset: string;
  /** From the order's own point of view: it is buying the token if it is
   *  offering XCP for it. Not the taker's side — an order is an offer. */
  side: "buy" | "sell";
  state: OrderState;
  block_index: number;
  expire_index: number;
  /** Original size, which is what the order's price is a statement about. */
  token_quantity: Raw;
  xcp_quantity: Raw;
  /** What is still unfilled. Price comes from the quantities above, amount
   *  from these: a half-filled order has not changed its price. */
  token_remaining: Raw;
  xcp_remaining: Raw;
  /** How much of the original has been taken, 0–1, rounded to four places.
   *  Derived here rather than in the browser because it is the same division
   *  for every client and the operands are raw integers. */
  filled: number;
  divisible: number;
}

/** Raw quantities arrive as a JSON number or, above 2^53, a lossless string.
 *  BigInt() throws on anything that is not a plain integer literal, and a
 *  throw here would take the whole route with it. */
function rawInt(value: Raw): bigint | null {
  const s = String(value);
  return /^-?\d+$/.test(s) ? BigInt(s) : null;
}

/** Fraction of the give leg already taken. An unreadable quantity yields 0
 *  rather than a guess — the row still renders, just without a fill meter. */
function filledFraction(quantity: Raw, remaining: Raw): number {
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
 * Not just the live book. An order that filled, expired or was cancelled is
 * the more informative event — it says what the market actually did, where a
 * resting offer only says what someone hopes it will do — so all four
 * Counterparty states arrive here and the client distinguishes them visually.
 *
 * That is also why this cannot be one chain-wide request. `/orders` unfiltered
 * is over half a million rows; asked per asset it is tens. The fan-out is
 * bounded by MAX_ORDER_ASSETS and ordered by pool depth, and `markets` /
 * `markets_read` report the bound so a capped answer never reads as a complete
 * one.
 *
 * Only TOKEN/XCP pairs. A launch's token can be offered against anything on
 * Counterparty, but XCP is the denomination every price on this site is quoted
 * in, and a book mixing denominations is a list of numbers that cannot be
 * compared to each other.
 *
 * A pair that fails to read is skipped rather than failing the tape, but if
 * EVERY pair fails the route 503s: an empty book and an unreachable node must
 * not look the same, and J only caches what it returns, so the failure is not
 * stored at the edge.
 */
activityRoute.get("/v2/activity/orders", async (c) => {
  const [markets, total] = await Promise.all([
    listMarketAssets(c.env.DB, MAX_ORDER_ASSETS),
    countMarketAssets(c.env.DB),
  ]);

  const books = await Promise.all(
    markets.map((m) =>
      fetchAssetOrders(m.asset)
        .then((orders) => ({ market: m, orders }))
        .catch(() => null),
    ),
  );
  const read = books.filter((b) => b !== null);
  if (markets.length > 0 && read.length === 0) {
    return c.json({ error: "order book unavailable" }, 503);
  }

  const rows: OrderRow[] = [];
  for (const { market, orders } of read) {
    for (const o of orders) {
      const buying = o.give_asset === "XCP";
      // Exactly one leg must be XCP. Without this an order swapping two launch
      // tokens would be priced as if the other side were XCP satoshi.
      if (buying === (o.get_asset === "XCP")) continue;
      if ((buying ? o.get_asset : o.give_asset) !== market.asset) continue;
      const filled = filledFraction(o.give_quantity, o.give_remaining);
      rows.push({
        tx_hash: o.tx_hash,
        source: o.source,
        asset: market.asset,
        side: buying ? "buy" : "sell",
        state: orderState(o.status, filled),
        block_index: o.block_index,
        expire_index: o.expire_index,
        token_quantity: buying ? o.get_quantity : o.give_quantity,
        xcp_quantity: buying ? o.give_quantity : o.get_quantity,
        token_remaining: buying ? o.get_remaining : o.give_remaining,
        xcp_remaining: buying ? o.give_remaining : o.get_remaining,
        filled,
        divisible: market.divisible,
      });
    }
  }

  // One chronology out of several per-asset ones. tx_index breaks a block tie
  // the way the chain itself does, so the order is stable between requests
  // and a pager cannot repeat or skip a row.
  rows.sort((a, b) => b.block_index - a.block_index || b.tx_hash.localeCompare(a.tx_hash));

  // `live=1` narrows to orders still resting on the book. Filtering HERE and
  // not in the browser is the whole point: the newest fifty orders on a pair
  // are mostly finished ones, so a client-side filter over one page would
  // answer "show me the live book" with whatever handful survived that page.
  // It is also a separate URL, so the edge cache keeps the two answers apart
  // instead of one poisoning the other.
  const live = c.req.query("live") === "1";
  const visible = live
    ? rows.filter((r) => r.state === "open" || r.state === "partial")
    : rows;

  const { limit, offset } = paging(c);
  const slice = visible.slice(offset, offset + limit);
  return J(
    c,
    {
      result: slice,
      result_count: slice.length,
      total: visible.length,
      // Always the unfiltered count, so a client can say what hiding cost
      // without asking twice.
      total_all: rows.length,
      markets: total?.n ?? markets.length,
      markets_read: read.length,
      next_offset: offset + limit < visible.length ? offset + limit : null,
    },
    ORDERS_TTL,
  );
});
