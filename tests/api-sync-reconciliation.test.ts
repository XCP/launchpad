import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "./fixtures/fewgoodman-index-recovery.json";
import { apiReplayDb } from "./helpers/api-replay-db";

vi.mock("#api/integrations/mempool", () => ({ fetchTxFee: async () => ({ feeSats: 100, weightWu: 400 }) }));
vi.mock("#api/integrations/price", () => ({ fetchXcpUsd: async () => null, fetchXcpUsdHistory: async () => [], historicalXcpUsdAt: () => null }));

const NOW = Date.parse("2026-09-07T22:00:00Z");
let database: ReturnType<typeof apiReplayDb>;
const hashes = ["aa".repeat(32), "bb".repeat(32)];
const assets = ["FIRSTMINT", "SECONDMINT"];
const launches = hashes.map((hash, i) => ({
  ...fixture.launch, tx_hash: hash, tx_index: 3183100 + i, asset: assets[i]!, status: "open", phase: "minting",
  block_index: 965923, soft_cap_deadline_block: 966923, current_deadline_block: 966923,
  earned_quantity: "1000000000000", paid_quantity: "10000000", divisible: true,
  burn_payment: false, lock_quantity: true, lock_description: true,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  database = apiReplayDb();
  const writable = new Set(database.raw.prepare("PRAGMA table_xinfo(launches)").all().filter(c => c.hidden === 0).map(c => c.name));
  for (const launch of launches) {
    const entries = Object.entries({ ...launch, earned_quantity: "0", paid_quantity: "0", mints: 0, minters: 0 }).filter(([key]) => writable.has(key));
    database.raw.prepare(`INSERT INTO launches (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
      .run(...entries.map(([,value]) => typeof value === "boolean" ? Number(value) : value));
  }
  // A later creation-event lookup must also be deferrable without preventing
  // the already inserted mint from reaching the materialized totals.
  database.raw.prepare("UPDATE launches SET announce_block=NULL WHERE tx_hash=?").run(hashes[1]!);
});
afterEach(() => { database.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("reconciles committed mint/reward totals when a later feed and backfill are throttled", async () => {
  let refuseSecond = true;
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v2/") return Response.json({ result: { counterparty_height: 965977 } });
    if (url.pathname === "/v2/fairminters") return Response.json({ result: launches, next_cursor: null });
    const i = hashes.findIndex(hash => url.pathname === `/v2/fairminters/${hash}/fairmints`);
    if (i >= 0) {
      if (i === 1 && refuseSecond) return new Response(null, { status: 429, headers: { "retry-after": "120" } });
      return Response.json({ result: [{ tx_hash: String(i + 1).repeat(64), tx_index: 3183160 + i,
        block_index: 965977, source: `minter${i}`, earn_quantity: "1000000000000", paid_quantity: "10000000", status: "valid" }], next_cursor: null });
    }
    if (url.pathname.endsWith("/events/NEW_FAIRMINTER")) return Response.json({ result: [] });
    throw new Error(`No fixture for ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  const { syncLaunches } = await import("#api/indexer/sync");
  const { runScheduledJob } = await import("#api/scheduler/job");
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const metadata = { get: async () => null } as unknown as R2Bucket;
  const first = await runScheduledJob("sync_launches", () => syncLaunches(database.db, metadata));
  expect(errors.mock.calls).toEqual([]);
  expect(first).toMatchObject({ partial: true, mints_ingested: 1, mint_feeds_failed: 1, announce_reads_deferred: 1 });
  expect(warning).toHaveBeenCalledWith(expect.objectContaining({ outcome: "partial", progress: expect.objectContaining({ mints_ingested: 1, mint_feeds_failed: 1 }) }));
  expect(errors).not.toHaveBeenCalled();
  expect(database.raw.prepare("SELECT mints,minters,paid_xcp FROM mint_totals WHERE id=1").get()).toEqual({ mints: 1, minters: 1, paid_xcp: 10_000_000 });
  expect(database.raw.prepare("SELECT n FROM mint_buckets WHERE bucket=6708").get()).toEqual({ n: 1 });
  expect(database.raw.prepare("SELECT earned_mints,paid_quantity FROM reward_accounts WHERE source='minter0'").get()).toEqual({ earned_mints: 1, paid_quantity: "10000000" });
  expect(database.raw.prepare("SELECT earned_quantity,mints FROM launches WHERE tx_hash=?").get(hashes[1]!)).toEqual({ earned_quantity: "0", mints: 0 });
  const callsAfter429 = fetch.mock.calls.length;
  await expect(syncLaunches(database.db, metadata)).rejects.toMatchObject({ name: "CounterpartyReadDeferred" });
  expect(fetch).toHaveBeenCalledTimes(callsAfter429);

  vi.setSystemTime(NOW + 120_000);
  refuseSecond = false;
  expect(await syncLaunches(database.db, metadata)).toMatchObject({ partial: false, mints_ingested: 1, mint_feeds_failed: 0 });
  expect(database.raw.prepare("SELECT mints,minters,paid_xcp FROM mint_totals WHERE id=1").get()).toEqual({ mints: 2, minters: 2, paid_xcp: 20_000_000 });
  expect(await syncLaunches(database.db, metadata)).toMatchObject({ partial: false, mints_ingested: 0, rollup_written: 0 });
  expect(database.raw.prepare("SELECT COUNT(*) AS n FROM launch_mints").get()).toEqual({ n: 2 });
});
