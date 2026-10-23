import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiReplayDb } from "./helpers/api-replay-db";
import fixture from "./fixtures/fewgoodman-index-recovery.json";
import { burnActivityByBucket, statsHeight, tradeActivityByBucket } from "#api/queries/stats";
import { statsActivity } from "@/lib/stats-activity";
import type { LaunchStats } from "@/lib/api/launchpad-api";

let database: ReturnType<typeof apiReplayDb>;
beforeEach(() => {
  database = apiReplayDb();
  const writable = new Set(database.raw.prepare("PRAGMA table_xinfo(launches)").all().filter(c => c.hidden === 0).map(c => c.name));
  for (const [asset, conforming] of [["COIN", 1], ["OTHER", 0]] as const) {
    const entries = Object.entries({ ...fixture.launch, asset, tx_hash: asset, tx_index: 100, conforming })
      .filter(([key]) => writable.has(key));
    database.raw.prepare(`INSERT INTO launches (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([, value]) => typeof value === "boolean" ? Number(value) : value));
  }
});
afterEach(() => { database.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("counts both trade directions once, retains multiple fills, and bounds the indexed window", async () => {
  const insert = database.raw.prepare(`INSERT INTO asset_events
    (id,event,address,asset,block_index,token_delta,xcp_delta,kind,primary_actor)
    VALUES (?,?, 'trader', ?,?, '1',?, 'buy',?)`);
  for (const [id, asset, height, xcp, primary] of [
    ["old", "COIN", 1439, "100", 1],
    ["pool1", "COIN", 1440, "-50000000", 1],
    ["pool2", "COIN", 1440, "-25000000", 1],
    ["book-taker", "COIN", 1583, "70000000", 1],
    ["book-maker", "COIN", 1583, "-70000000", 0],
    ["next", "COIN", 1584, "1000000", 1],
    ["future", "COIN", 1585, "100", 1],
    ["excluded", "OTHER", 1440, "100", 1],
  ] as const) insert.run(id, id, asset, height, xcp, primary);
  expect(await tradeActivityByBucket(database.db, 1440, 1584)).toEqual([
    { bucket: 10, n: 3, xcp: "145000000" }, { bucket: 11, n: 1, xcp: "1000000" },
  ]);
});

it("keeps burn quantities exact and excludes pre-relaunch supply and non-launch assets", async () => {
  const insert = database.raw.prepare(`INSERT INTO token_burns
    (key,tx_hash,tx_index,msg_index,block_index,source,destination,asset,quantity)
    VALUES (?, 'tx',?,0,?, 'holder','burn',?,?)`);
  for (const [key, tx, height, asset, quantity] of [
    ["burn:1", 101, 1440, "COIN", "9007199254740993"],
    ["destroy:2", 102, 1583, "COIN", "2"],
    ["old-issuance", 99, 1440, "COIN", "100"],
    ["lp", 103, 1440, "LP", "100"],
    ["other", 103, 1440, "OTHER", "100"],
    ["old-window", 101, 1439, "COIN", "100"],
    ["future", 103, 1584, "COIN", "100"],
  ] as const) insert.run(key, tx, height, asset, quantity);
  expect(await burnActivityByBucket(database.db, 1440, 1583)).toEqual([
    { bucket: 10, asset: "COIN", divisible: 1, n: 2, quantity: "9007199254740995" },
  ]);
});

it("uses the stored indexed height", async () => {
  expect(await statsHeight(database.db)).toBe(0);
  database.raw.prepare("INSERT INTO chain_state(key,value) VALUES ('block_height','1584')").run();
  expect(await statsHeight(database.db)).toBe(1584);
});

it("only queries detailed charts on request and anchors them to the indexed tip", async () => {
  vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
  const { launchesRoute } = await import("#api/read/launches");
  database.raw.prepare("INSERT INTO chain_state(key,value) VALUES ('block_height','800000')").run();
  const prepare = vi.spyOn(database.db, "prepare");
  const env = { DB: database.db };
  const execution = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };
  const basic = await launchesRoute.request("https://api.xcp.fun/v2/stats?height=800000", {}, env, execution);
  expect(basic.status).toBe(200);
  expect((await basic.json()).result.ecosystem).toBeUndefined();
  expect(prepare.mock.calls.some(([sql]) => /FROM (asset_events|token_burns)/.test(sql))).toBe(false);

  const detailed = await launchesRoute.request("https://api.xcp.fun/v2/stats?activity=1&height=99999999", {}, env, execution);
  expect(detailed.status).toBe(200);
  expect((await detailed.json()).result.ecosystem).toEqual({ height: 800000, trades_daily: [], burns_daily: [] });
  expect(detailed.headers.get("cache-control")).toContain("max-age=300");
});

const stats = {
  blocks_per_bucket: 144, daily: [{ bucket: 4, n: 99 }, { bucket: 5, n: 2 }, { bucket: 11, n: 1 }],
  ecosystem: { height: 1584, trades_daily: [{ bucket: 5, n: 3, xcp: "145000000" }],
    burns_daily: [
      { bucket: 4, asset: "OLD", divisible: 1, n: 9, quantity: "1" },
      { bucket: 5, asset: "COIN", divisible: 1, n: 2, quantity: "9007199254740993" },
      { bucket: 11, asset: "COIN", divisible: 1, n: 1, quantity: "2" },
      { bucket: 11, asset: "TICKET", divisible: 0, n: 4, quantity: "8" },
      { bucket: 12, asset: "FUTURE", divisible: 1, n: 9, quantity: "1" },
    ] },
} as LaunchStats;

it("zero-fills aligned buckets and totals only the selected window without mixing token units", () => {
  const view = statsActivity(stats, 7)!;
  expect(view.series.map(d => d.bucket)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  expect(view.series[1]).toEqual({ bucket: 6, mints: 0, fills: 0, xcp: 0n, burns: 0 });
  expect(view.totals).toEqual({ mints: 3, fills: 3, xcp: 145000000n, burns: 7 });
  expect(view.assets).toEqual([
    { asset: "TICKET", divisible: false, n: 4, quantity: 8n },
    { asset: "COIN", divisible: true, n: 3, quantity: 9007199254740995n },
  ]);
  expect(statsActivity(stats, 90)!.series).toHaveLength(90);
});

it("distinguishes unavailable activity from a verified empty window", () => {
  expect(statsActivity({ ...stats, ecosystem: undefined }, 7)).toBeNull();
  expect(statsActivity({ ...stats, ecosystem: { ...stats.ecosystem!, height: 0 } }, 7)).toBeNull();
  const empty = statsActivity({ ...stats, daily: [], ecosystem: { height: 1584, trades_daily: [], burns_daily: [] } }, 7)!;
  expect(empty.totals).toEqual({ mints: 0, fills: 0, xcp: 0n, burns: 0 });
  expect(empty.assets).toEqual([]);
});
