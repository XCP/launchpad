/**
 * The Telegram feed must not depend on a Counterparty read of its own.
 *
 * It runs straight after the indexer's pass, which is exactly when the node
 * is likeliest to be refusing this worker. For a while every announce tick
 * died on its opening height read, with confirmed mints sitting in the
 * outbox, and the channel went quiet for over an hour while the index itself
 * was fine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/fewgoodman-index-recovery.json";
import { apiReplayDb } from "./helpers/api-replay-db";
import type { Env } from "#api/env";

vi.mock("#api/integrations/mempool", () => ({ fetchTxFee: async () => ({ feeSats: 100, weightWu: 400 }) }));
vi.mock("#api/integrations/price", () => ({ fetchXcpUsd: async () => null, fetchXcpUsdHistory: async () => [], historicalXcpUsdAt: () => null }));

const NOW = Date.parse("2026-09-14T03:00:00Z");
const HEIGHT = 965977;
let database: ReturnType<typeof apiReplayDb>;

function insertLaunch(over: Record<string, unknown>) {
  const writable = new Set(database.raw.prepare("PRAGMA table_xinfo(launches)").all().filter(c => c.hidden === 0).map(c => c.name));
  const entries = Object.entries({ ...fixture.launch, ...over }).filter(([key]) => writable.has(key));
  database.raw.prepare(`INSERT INTO launches (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
    .run(...entries.map(([, value]) => (typeof value === "boolean" ? Number(value) : value) as string | number | null));
}

const throttled = () => new Response(null, { status: 429, headers: { "retry-after": "120" } });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  database = apiReplayDb();
});
afterEach(() => { database.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the feed announces from the height the indexer stored", () => {
  it("posts the outbox while every node read is refused, and skips only the burn scan", async () => {
    const hash = fixture.launch.tx_hash;
    insertLaunch({ status: "open", phase: "minting", earned_quantity: "0", paid_quantity: "0", mints: 0, minters: 0,
      pool_xcp_reserve: null, pool_token_reserve: null, pool_xcp_sats: 0, lp_asset: null });
    database.raw.prepare("INSERT INTO chain_state (key, value) VALUES ('block_height', ?)").run(String(HEIGHT));
    database.raw.prepare("UPDATE announce_state SET value = '1' WHERE key = 'live'").run();
    const fetch = vi.fn(async () => throttled());
    vi.stubGlobal("fetch", fetch);
    const enqueue = vi.fn(async (items: { key: string }[]) => {
      const keys = items.map(item => item.key);
      return { depth: keys.length, newlyAccepted: keys, known: keys };
    });
    const env = {
      DB: database.db,
      METADATA: { get: async () => null },
      ANNOUNCER: { idFromName: () => "global", get: () => ({ enqueue }) },
    } as unknown as Env;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { currentHeight } = await import("#api/indexer/height");
    const { announceLive } = await import("#api/telegram/live");
    const height = await currentHeight(database.db);
    expect(height).toBe(HEIGHT);
    expect(fetch).not.toHaveBeenCalled();

    const result = await announceLive(env, height);
    expect(result).toEqual({ announced: 2, queued: 2 });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]![0].map(item => item.key).sort()).toEqual([`launch:${hash}`, `open:${hash}`]);
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ event: "burn_scan_skipped" }));
    expect(database.raw.prepare("SELECT COUNT(*) AS n FROM announcement_work").get()).toEqual({ n: 0 });
    expect(database.raw.prepare("SELECT COUNT(*) AS n FROM announced").get()).toEqual({ n: 2 });
    // The refused scan advanced no burn cursor: the only state row is the height.
    expect(database.raw.prepare("SELECT key FROM chain_state ORDER BY key").all()).toEqual([{ key: "block_height" }]);
  });

  it("falls back to the node only before the first index pass has stored a height", async () => {
    const fetch = vi.fn(async () => Response.json({ result: { counterparty_height: HEIGHT + 1 } }));
    vi.stubGlobal("fetch", fetch);
    const { currentHeight } = await import("#api/indexer/height");
    expect(await currentHeight(database.db)).toBe(HEIGHT + 1);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("the index pass stops re-asking about pools it has already found missing", () => {
  it("records the height and skips the pool lookup for a launch on record as refunded", async () => {
    const refundedHash = "cc".repeat(32);
    insertLaunch({});
    insertLaunch({ tx_hash: refundedHash, tx_index: fixture.launch.tx_index + 1, asset: "NOPOOL", phase: "refunded",
      earned_quantity: "100000000000000", paid_quantity: "1000000", mints: 1, minters: 1,
      pool_xcp_reserve: null, pool_token_reserve: null, pool_xcp_sats: 0, lp_asset: null });
    const listing = (over: Record<string, unknown>) => ({
      ...fixture.launch, block_index: fixture.launch.start_block, soft_cap_deadline_block: fixture.launch.current_deadline_block,
      divisible: true, burn_payment: false, lock_quantity: true, lock_description: true, ...over,
    });
    const fairminters = [
      listing({}),
      listing({ tx_hash: refundedHash, tx_index: fixture.launch.tx_index + 1, asset: "NOPOOL", lp_asset: null,
        earned_quantity: "100000000000000", paid_quantity: "1000000" }),
    ];
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v2/") return Response.json({ result: { counterparty_height: HEIGHT } });
      if (url.pathname === "/v2/fairminters") return Response.json({ result: fairminters, next_cursor: null });
      if (url.pathname === "/v2/pools/FEWGOODMAN/XCP") {
        return Response.json({ result: { asset_a: "XCP", asset_b: "FEWGOODMAN",
          reserve_a: fixture.launch.pool_xcp_reserve, reserve_b: fixture.launch.pool_token_reserve } });
      }
      if (url.pathname === "/v2/pools/NOPOOL/XCP") return new Response(null, { status: 404 });
      return Response.json({ result: [], next_cursor: null });
    });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { syncLaunches } = await import("#api/indexer/sync");
    const metadata = { get: async () => null } as unknown as R2Bucket;

    const result = await syncLaunches(database.db, metadata);
    expect(result).toMatchObject({ pool_lookups_failed: 0, pool_lookups_deferred: 0 });
    const asked = fetch.mock.calls.map(([input]) => new URL(input).pathname).filter(path => /^\/v2\/pools\/[A-Z]+\/XCP$/.test(path));
    expect(asked).toEqual(["/v2/pools/FEWGOODMAN/XCP"]);
    expect(database.raw.prepare("SELECT phase FROM launches WHERE tx_hash=?").get(refundedHash)).toEqual({ phase: "refunded" });
    expect(database.raw.prepare("SELECT phase, pool_xcp_reserve FROM launches WHERE tx_hash=?").get(fixture.launch.tx_hash))
      .toEqual({ phase: "graduated", pool_xcp_reserve: fixture.launch.pool_xcp_reserve });
    expect(database.raw.prepare("SELECT value FROM chain_state WHERE key='block_height'").get()).toEqual({ value: String(HEIGHT) });
  });
});
