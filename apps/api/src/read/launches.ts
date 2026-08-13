import { getCandles, RESOLUTIONS } from "#api/queries/candles";
import {
  activityTotals,
  countByPhase,
  mintsByBucket,
  getEventsBySource,
  getLaunch,
  getLaunchesBySource,
  getMintsBySource,
  minterEarnings,
  listLaunches,
  listMinters,
  sumFees,
} from "#api/queries/launches";
import { J, router } from "./respond";

export const launchesRoute = router();

launchesRoute.get("/v2/launches", async (c) => {
  const perPhase = Math.min(Number(c.req.query("per_phase") ?? 12) || 12, 50);
  const result = await listLaunches(c.env.DB, perPhase);
  return J(c, { result, result_count: result.length }, 60);
});

// Conforming launches per phase. The homepage shows a slice of each section
// and needs the size of the whole; /stats asks the same question directly.
/** ~28 Bitcoin days of history, which is as far back as a "what's happening
 *  lately" chart stays a chart rather than a timeline. */
const ACTIVITY_BUCKETS = 28;
const BLOCKS_PER_DAY = 144;

launchesRoute.get("/v2/stats", async (c) => {
  const height = Number(c.req.query("height") ?? 0) || 0;
  const since = height > 0 ? Math.max(0, height - ACTIVITY_BUCKETS * BLOCKS_PER_DAY) : 0;
  const [rows, totals, buckets] = await Promise.all([
    countByPhase(c.env.DB),
    activityTotals(c.env.DB),
    mintsByBucket(c.env.DB, since),
  ]);
  const counts: Record<string, number> = {
    scheduled: 0,
    minting: 0,
    graduated: 0,
    refunded: 0,
  };
  for (const r of rows) counts[r.phase] = r.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return J(
    c,
    {
      result: {
        counts,
        total,
        activity: totals[0] ?? { mints: 0, minters: 0, paid_xcp: 0, fee_sats: 0 },
        // Bucket index is `block / 144`; the client turns it back into an
        // approximate day using the height it already has.
        daily: buckets,
        blocks_per_bucket: BLOCKS_PER_DAY,
      },
    },
    60,
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
  const result = await minterEarnings(c.env.DB, limit, source);
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
  const result = await getEventsBySource(c.env.DB, source, limit);
  return J(c, { result, result_count: result.length }, 15);
});

// An address's own mints across every launch — the profile activity feed.
launchesRoute.get("/v2/mints/by/:source", async (c) => {
  const source = c.req.param("source");
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 1000);
  const result = await getMintsBySource(c.env.DB, source, limit);
  return J(c, { result, result_count: result.length }, 15);
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

launchesRoute.get("/v2/launches/:asset/fees", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const launch = await getLaunch(c.env.DB, asset);
  if (!launch) return J(c, { result: null }, 15);
  const result = await sumFees(c.env.DB, launch.tx_hash);
  return J(c, { result }, 15);
});
