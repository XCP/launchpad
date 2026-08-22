import { getCandles, RESOLUTIONS } from "#api/queries/candles";
import { isXcp69 } from "@launchpad/xcp69/xcp69";
import {
  fetchMempoolFairminters,
  fetchMempoolFairmints,
  fetchMempoolOrders,
} from "#api/integrations/counterparty";
import {
  listConformingAssets,
  countByPhase,
  getMintTotals,
  listMintBuckets,
  getEventsBySource,
  getLaunch,
  getLaunchesBySource,
  getMintsBySource,
  isLaunchPhase,
  minterEarnings,
  refundsByBucket,
  listLaunches,
  listLaunchPage,
  listMinters,
  listSearchIndex,
  sumFees,
} from "#api/queries/launches";
import { J, router } from "#api/read/respond";
import { getRewardAccount, listRewardBatches } from "#api/queries/rewards";

export const launchesRoute = router();

/** Page sizes are the caller's business, but not without a ceiling — `limit`
 *  arrives in a query string and bounds how many rows one request can read. */
const MAX_PAGE = 100;
/** Deep enough for any real list, shallow enough that a crafted `offset`
 *  cannot ask SQLite to walk an absurd number of rows to discard them. */
const MAX_OFFSET = 100_000;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * The launch index, in two modes.
 *
 * With `phase`, it is ordinary offset/limit pagination over one phase:
 * `{ result, total, limit, offset, sort }`, where `total` counts the phase and
 * not the page. That is what the homepage sections use, and `total` is the
 * point of it — the pager and the heading now read the same number from the
 * same query, where before the heading counted the table via /v2/stats and the
 * pager divided a fixed-size prefetch, so a section could truthfully say "30"
 * above a list with no way to reach row 25.
 *
 * Without it, the old behaviour: the top `per_phase` of every phase in one
 * response. Nothing on the site pages with that any more, but it is how the
 * profile and portfolio views ask for "every launch, so I can price a holding"
 * — a universe, not a list — and it is a published endpoint besides.
 */
launchesRoute.get("/v2/launches", async (c) => {
  const phase = c.req.query("phase");
  if (phase !== undefined) {
    if (!isLaunchPhase(phase)) {
      return c.json({ error: `unknown phase '${phase}'` }, 400);
    }
    const limit = clamp(Number(c.req.query("limit") ?? 24) || 24, 1, MAX_PAGE);
    const offset = clamp(Number(c.req.query("offset") ?? 0) || 0, 0, MAX_OFFSET);
    const sort = c.req.query("sort");
    const unmintedBy = c.req.query("unminted_by")?.trim() || undefined;
    // A real wallet address is alphanumeric and comfortably below 90 chars.
    // Reject arbitrary cache-busting strings before they reach D1: this route
    // is edge-cached by URL, so binding alone protects SQL but not resources.
    if (unmintedBy && !/^[A-Za-z0-9]{26,90}$/.test(unmintedBy)) {
      return c.json({ error: "invalid unminted_by address" }, 400);
    }
    const { rows, total, king } = await listLaunchPage(
      c.env.DB,
      phase,
      sort,
      limit,
      offset,
      unmintedBy,
    );
    // `king` is the launch that minted most recently out of everything still
    // minting — a fact about the phase, not about this page, which is why it
    // travels beside `result` rather than inside it. Null for every phase but
    // minting. An older client that does not know the field ignores it.
    return J(c, { result: rows, result_count: rows.length, total, limit, offset, king }, 60);
  }

  const perPhase = Math.min(Number(c.req.query("per_phase") ?? 12) || 12, 50);
  const result = await listLaunches(c.env.DB, perPhase);
  return J(c, { result, result_count: result.length }, 60);
});

/**
 * The whole conforming set, in the columns search ranks on.
 *
 * Registered ahead of /v2/launches/:asset so the static segment wins — the
 * same thing /v2/launches/by/:source already relies on.
 *
 * Search cannot be paged the way a list can: someone typing an exact ticker
 * has said precisely what they want, and answering "no such launch" because it
 * fell outside a window is a worse failure than a list being short. So this is
 * the one read that is deliberately unbounded by design — bounded instead by
 * the conforming set, which is the thing the site is actually about.
 */
launchesRoute.get("/v2/launches/index", async (c) => {
  const result = await listSearchIndex(c.env.DB);
  return J(c, { result, result_count: result.length }, 60);
});

// Conforming launches per phase. The homepage shows a slice of each section
// and needs the size of the whole; /stats asks the same question directly.
/** ~28 Bitcoin days of history, which is as far back as a "what's happening
 *  lately" chart stays a chart rather than a timeline. */
const ACTIVITY_BUCKETS = 28;
const BLOCKS_PER_DAY = 144;
/** Edge-cache lifetimes, in seconds, kept together so the site's freshness
 *  policy reads as one decision rather than as numbers scattered per route.
 *  STATS_TTL matches the cron interval; nothing it summarises can change
 *  faster than that. MEMPOOL_TTL is the one route whose upstream is someone
 *  else's public node, so its TTL is as much politeness as performance. */
const STATS_TTL = 300;
const MEMPOOL_TTL = 15;

launchesRoute.get("/v2/stats", async (c) => {
  const height = Number(c.req.query("height") ?? 0) || 0;
  const since = height > 0 ? Math.max(0, height - ACTIVITY_BUCKETS * BLOCKS_PER_DAY) : 0;
  const sinceBucket = Math.floor(since / BLOCKS_PER_DAY);
  const [rows, totals, buckets, refundBuckets] = await Promise.all([
    countByPhase(c.env.DB),
    getMintTotals(c.env.DB),
    // Whole buckets, so the window is expressed in the unit the rollup stores.
    listMintBuckets(c.env.DB, sinceBucket),
    refundsByBucket(c.env.DB, sinceBucket),
  ]);
  const counts: Record<string, number> = {
    scheduled: 0,
    minting: 0,
    graduated: 0,
    refunded: 0,
  };
  for (const r of rows) counts[r.phase] = r.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const activeXcp = rows.find((r) => r.phase === "minting")?.paid_xcp ?? 0;
  const graduated = rows.find((r) => r.phase === "graduated");
  const markets = {
    pool_xcp: graduated?.pool_xcp ?? 0,
    market_cap_xcp: graduated?.market_cap_xcp ?? 0,
  };
  const activity = totals
    ? { ...totals, active_xcp: activeXcp }
    : { mints: 0, minters: 0, paid_xcp: 0, active_xcp: activeXcp, fee_sats: 0 };
  return J(
    c,
    {
      result: {
        counts,
        total,
        activity,
        markets,
        // Bucket index is `block / 144`; the client turns it back into an
        // approximate day using the height it already has.
        daily: buckets,
        refunds_daily: refundBuckets,
        blocks_per_bucket: BLOCKS_PER_DAY,
      },
    },
    // Matched to the indexer's own cadence rather than the 60s every other
    // route uses: the cron writes every 5 minutes, so a shorter TTL cannot
    // make this fresher — it can only re-serve the same answer more times.
    //
    // This used to be the cost control, back when the route ran three full
    // aggregates per request. Since migration 0010 those are materialised and
    // a miss costs a primary-key lookup plus a short indexed range, so the TTL
    // is now about freshness honesty rather than about cost.
    STATS_TTL,
  );
});

// "My launches" — a wallet's own creations, unfiltered by conformance
// verdict. Cached briefly: this is read right after a wallet connects, not
// polled, so a short TTL just takes the edge off a refresh-spam.
launchesRoute.get("/v2/launches/by/:source", async (c) => {
  const source = c.req.param("source");
  const result = await getLaunchesBySource(c.env.DB, source);
  return J(c, { result, result_count: result.length }, 15);
});

// The rewards leaderboard: who has minted, most first. Counted per mint
// TRANSACTION, which is the unit the reward is paid in.
launchesRoute.get("/v2/minters", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 25) || 25, 100);
  const source = c.req.query("source") || undefined;
  // Offset paging for the leaderboard. The aggregate scans the same rows
  // whatever the offset, so a deep page costs what page one costs — and the
  // 60s cache means D1 sees each (limit, offset) at most once a minute.
  const offset = Math.min(Math.max(0, Number(c.req.query("offset") ?? 0) || 0), 100_000);
  const result = await minterEarnings(c.env.DB, limit, source, offset);
  return J(c, { result, result_count: result.length }, 60);
});

// Programme accounting for one address. `has_reward_tx` is the product
// boundary: before it turns true the address has accrued rewards, but there is
// no transaction history to justify a Rewards tab on its profile.
launchesRoute.get("/v2/rewards/by/:source", async (c) => {
  const source = c.req.param("source");
  const result = await getRewardAccount(c.env.DB, source);
  return J(c, { result }, 60);
});

// Only distributions with an actual broadcast/confirmed transaction are
// public. A frozen operator manifest is preparation, not payment history.
launchesRoute.get("/v2/rewards/batches", async (c) => {
  const result = await listRewardBatches(c.env.DB);
  return J(c, { result, result_count: result.length }, 60);
});

launchesRoute.get("/v2/launches/:asset", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const result = await getLaunch(c.env.DB, asset);
  if (!result) return J(c, { result: null }, 15);
  return J(c, { result }, 15);
});

// An address's trades on XCP-69 assets, for positions and PnL.
launchesRoute.get("/v2/events/by/:source", async (c) => {
  const source = c.req.param("source");
  const limit = Math.min(Number(c.req.query("limit") ?? 500) || 500, 2000);
  const offset = Math.min(Math.max(0, Number(c.req.query("offset") ?? 0) || 0), 100_000);
  const result = await getEventsBySource(c.env.DB, source, limit, offset);
  return J(c, {
    result,
    result_count: result.length,
    next_offset: result.length === limit ? offset + limit : null,
  }, 15);
});

// An address's own mints across every launch — the profile activity feed.
launchesRoute.get("/v2/mints/by/:source", async (c) => {
  const source = c.req.param("source");
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 1000);
  const offset = Math.min(Math.max(0, Number(c.req.query("offset") ?? 0) || 0), 100_000);
  const result = await getMintsBySource(c.env.DB, source, limit, offset);
  return J(c, {
    result,
    result_count: result.length,
    next_offset: result.length === limit ? offset + limit : null,
  }, 15);
});

// OHLCV for a TOKEN/XCP pair, folded by the indexer from the same pool and
// order-book matches the event rows come from. `scale` travels with the data
// so a client divides by what these prices were actually scaled with rather
// than by a constant it copied and could drift from.
launchesRoute.get("/v2/candles/:asset", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const resolution = c.req.query("resolution") ?? "1d";
  if (!RESOLUTIONS.has(resolution)) {
    return c.json({ error: `unknown resolution '${resolution}'` }, 400);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 500) || 500, 2000);
  const result = await getCandles(c.env.DB, asset, resolution, limit);
  return J(c, { result, result_count: result.length, resolution, scale: "100000000" }, 60);
});

launchesRoute.get("/v2/launches/:asset/minters", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const launch = await getLaunch(c.env.DB, asset);
  if (!launch) return J(c, { result: [] }, 15);
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 1000);
  const result = await listMinters(c.env.DB, launch.tx_hash, limit);
  return J(c, { result, result_count: result.length }, 15);
});

/**
 * The unconfirmed view of the chain, filtered to what this site covers.
 *
 * This exists to stop a launch from clobbering Counterparty. The header chip
 * carries this poll, the header is on every page, so it ran once per OPEN TAB
 * every 30 seconds — two `limit=500` mempool requests each, straight from the
 * browser to a public Counterparty node. A thousand tabs is ~66 requests a
 * second at someone else's server. It is precisely the pattern LaunchRoom was
 * built to remove from the asset page, reintroduced site-wide by putting the
 * chip in the header.
 *
 * Behind the edge cache the same thousand tabs become about one Counterparty
 * request per colo per TTL. The filtering moves here too, which costs the
 * browser nothing and saves it a second request: the conforming set is a D1
 * read on this side, where the client had to fetch the whole launch index to
 * learn the same thing.
 *
 * The verdict is the shared predicate, not a re-implementation — the same
 * isXcp69 the indexer and the web app both use. A mempool row is judged with
 * no announcement block, which is correct: the timing clause passes for an
 * unconfirmed row because it cannot have opened before it confirmed.
 *
 * MEMPOOL_TTL is 15s rather than the 30s the client used to poll at. The cost
 * of freshness is now paid once per colo instead of once per tab, so it can
 * afford to be better than what it replaces.
 */
launchesRoute.get("/v2/mempool", async (c) => {
  const [rawFairminters, rawMints, rawOrders] = await Promise.all([
    fetchMempoolFairminters(),
    fetchMempoolFairmints(),
    fetchMempoolOrders(),
  ]);

  // No cast. CpFairminter is structurally a Fairminter, and the indexer calls
  // isXcp69 on one directly for exactly that reason — so if the two ever drift
  // apart, this must fail to compile rather than be waved through. A cast here
  // would silence the compiler at the one boundary where this repo's editorial
  // policy is actually applied.
  const fairminters = rawFairminters.filter((fm) => isXcp69(fm, undefined));

  // A launch still in the mempool can already have mints queued behind it, so
  // the covered set is what D1 knows plus what was just judged above. Same
  // two-part rule the client used, with the indexed half now a query instead
  // of a download.
  //
  // Only when there is something to filter. An empty mempool is the normal
  // state — most of the time nothing is queued at all — and reading every
  // conforming launch to decide which of zero mints to keep was this
  // database's single largest read: ~77,000 rows a day answering a question
  // with no rows in it. The set is a membership test, so with nothing to test
  // there is nothing to fetch.
  let mints = rawMints;
  let orders = rawOrders;
  if (rawMints.length > 0 || rawOrders.length > 0) {
    const covered = new Set(await listConformingAssets(c.env.DB));
    for (const fm of fairminters) covered.add(fm.asset);
    mints = rawMints.filter((m) => covered.has(m.asset));
    orders = rawOrders.filter(
      (o) =>
        ((o.giveAsset === "XCP" && covered.has(o.getAsset)) ||
          (o.getAsset === "XCP" && covered.has(o.giveAsset))) &&
        covered.has(o.asset),
    );
  }

  return J(
    c,
    {
      result: { fairminters, mints, orders, fetched_at: Math.floor(Date.now() / 1000) },
      result_count: fairminters.length + mints.length + orders.length,
    },
    MEMPOOL_TTL,
  );
});

launchesRoute.get("/v2/launches/:asset/fees", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const launch = await getLaunch(c.env.DB, asset);
  if (!launch) return J(c, { result: null }, 15);
  const result = await sumFees(c.env.DB, launch.tx_hash);
  return J(c, { result }, 15);
});
