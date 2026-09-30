import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/fewgoodman-index-recovery.json";
import { apiReplayDb } from "./helpers/api-replay-db";
import { CORE_ACTIVATIONS, coreVersionGate, parseCoreVersion } from "#api/indexer/core-version";

vi.mock("#api/integrations/mempool", () => ({ fetchTxFee: async () => ({ feeSats: 100, weightWu: 400 }) }));
vi.mock("#api/integrations/price", () => ({ fetchXcpUsd: async () => null, fetchXcpUsdHistory: async () => [], historicalXcpUsdAt: () => null }));

const NOW = Date.parse("2026-09-30T16:00:00Z");
let database: ReturnType<typeof apiReplayDb>;
const metadata = { get: async () => null } as unknown as R2Bucket;
const count = (sql: string, ...binds: Array<string | number>) =>
  (database.raw.prepare(sql).get(...binds) as { n: number }).n;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  database = apiReplayDb();
});
afterEach(() => { database.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Core version gate", () => {
  it("keeps every activation in one table, in height order", () => {
    expect(CORE_ACTIVATIONS.map(a => [a.change, a.block, a.version])).toEqual([
      ["require_reveal_source_signature", 969_320, "11.5.0"],
      ["mpma_taproot_support", 971_700, "11.4.0"],
    ]);
  });

  it("parses release numbers and nothing else", () => {
    expect(parseCoreVersion("11.5.0")).toEqual([11, 5, 0]);
    expect(parseCoreVersion("v11.10.2rc1")).toEqual([11, 10, 2]);
    expect(parseCoreVersion("develop")).toBeNull();
    expect(parseCoreVersion(null)).toBeNull();
  });

  it.each([
    [969_319, "11.4.0", true],
    [969_319, null, true],
    [969_320, "11.4.0", false],
    [969_320, "11.4.9", false],
    [969_320, "11.5.0", true],
    [969_320, "11.10.0", true],
    [969_320, "12.0.0", true],
    [969_320, null, false],
    [971_700, "11.5.0", true],
    [971_700, "10.9.9", false],
  ] as const)("at %i a node on %s may be indexed: %s", (height, version, ok) => {
    expect(coreVersionGate(version, height).ok).toBe(ok);
  });

  it("pauses the pass, reading and writing nothing past the node status", async () => {
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v2/") return Response.json({ result: { counterparty_height: 969_320, version: "11.4.0" } });
      throw new Error(`unexpected read ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { syncLaunches } = await import("#api/indexer/sync");
    const result = await syncLaunches(database.db, metadata);
    expect(result).toMatchObject({ paused: true, partial: true, candidates: 0, written: 0 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: "indexer_paused", change: "require_reveal_source_signature", required: "11.5.0", version: "11.4.0", height: 969_320,
    }));
    expect(count("SELECT COUNT(*) AS n FROM chain_state")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM indexed_blocks")).toBe(0);
  });
});

describe("Counterparty API base", () => {
  it("defaults to the public node, follows COUNTERPARTY_API_BASE, and refuses a malformed one", async () => {
    const fetch = vi.fn(async () => Response.json({ result: { counterparty_height: 1, version: "11.5.0" } }));
    vi.stubGlobal("fetch", fetch);
    const { configureCounterpartyApi, counterpartyApiBase, fetchNodeStatus } = await import("#api/integrations/counterparty");
    expect(counterpartyApiBase()).toBe("https://api.counterparty.io:4000/v2");
    configureCounterpartyApi({ COUNTERPARTY_API_BASE: "http://127.0.0.1:24000/v2/" });
    expect(await fetchNodeStatus()).toEqual({ height: 1, version: "11.5.0" });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:24000/v2/", expect.anything());
    configureCounterpartyApi({});
    expect(counterpartyApiBase()).toBe("https://api.counterparty.io:4000/v2");
    expect(() => configureCounterpartyApi({ COUNTERPARTY_API_BASE: "ftp://node/v2" })).toThrow();
    expect(() => configureCounterpartyApi({ COUNTERPARTY_API_BASE: "https://node/v2?key=1" })).toThrow();
  });
});

/**
 * One open launch, and a chain that Core re-parses from block 965,978 on
 * between two ticks: the mint in block 965,979 is gone and another of the
 * same size lands in 965,980, so the launch's earned total is unchanged and
 * only the ledger hashes say anything moved. A pending launch announced in
 * 965,979 is gone from the node's listing too.
 */
describe("re-parse detection", () => {
  const TIP = 965_980;
  const FORK = 965_978;
  const launch = {
    ...fixture.launch, status: "open", phase: "minting", block_index: 965_923, soft_cap_deadline_block: 966_923,
    earned_quantity: "2000000000000", paid_quantity: "20000000", divisible: true, burn_payment: false,
    lock_quantity: true, lock_description: true,
  };
  const pending = { ...launch, tx_hash: "dd".repeat(32), tx_index: fixture.launch.tx_index + 9, asset: "LATECOMER",
    status: "pending", block_index: 965_979, start_block: 966_000, soft_cap_deadline_block: 967_000,
    earned_quantity: null, paid_quantity: null };
  const mint = (hash: string, block: number, txIndex: number) => ({ tx_hash: hash.repeat(64), tx_index: txIndex,
    block_index: block, source: `minter-${hash}`, earn_quantity: "1000000000000", paid_quantity: "10000000", status: "valid" });
  const before = [mint("1", 965_975, 3_200_001), mint("2", 965_979, 3_200_002)];
  const after = [mint("1", 965_975, 3_200_001), mint("3", 965_980, 3_200_003)];
  const hashes = (reparsed: boolean) => Array.from({ length: 12 }, (_, i) => TIP - i).map(block => ({
    block_index: block,
    ledger_hash: `${reparsed && block >= FORK ? "b" : "a"}${block}`,
    messages_hash: `${reparsed && block >= FORK ? "n" : "m"}${block}`,
  }));

  function chain(state: { reparsed: boolean; blocksDown?: boolean }) {
    return vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/v2/") return Response.json({ result: { counterparty_height: TIP, version: "11.4.0" } });
      if (url.pathname === "/v2/blocks") {
        if (state.blocksDown) return new Response(null, { status: 503 });
        return Response.json({ result: hashes(state.reparsed), next_cursor: TIP - 12 });
      }
      if (url.pathname === "/v2/fairminters") {
        return Response.json({ result: state.reparsed ? [launch] : [launch, pending], next_cursor: null });
      }
      if (url.pathname === `/v2/fairminters/${launch.tx_hash}/fairmints`) {
        return Response.json({ result: state.reparsed ? after : before, next_cursor: null });
      }
      return Response.json({ result: [], next_cursor: null });
    });
  }

  it("records the window, then rolls back to the last matching block and re-reads from there", async () => {
    const state = { reparsed: false };
    vi.stubGlobal("fetch", chain(state));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { syncLaunches } = await import("#api/indexer/sync");

    const first = await syncLaunches(database.db, metadata);
    expect(first).toMatchObject({ paused: false, mints_ingested: 2, ledger_blocks_compared: 0, ledger_rolled_back_to: null });
    expect(count("SELECT COUNT(*) AS n FROM indexed_blocks")).toBe(12);
    expect(count("SELECT COUNT(*) AS n FROM launches WHERE tx_hash = ?", pending.tx_hash)).toBe(1);

    // A quiet tick compares the window and writes nothing new.
    const quiet = await syncLaunches(database.db, metadata);
    expect(quiet).toMatchObject({ ledger_blocks_compared: 12, ledger_rolled_back_to: null, mints_ingested: 0, rollup_written: 0 });

    state.reparsed = true;
    const second = await syncLaunches(database.db, metadata);
    expect(second).toMatchObject({ ledger_rolled_back_to: FORK - 1, mints_ingested: 1, partial: false });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      event: "ledger_reparse_detected", first_changed_block: FORK, rolled_back_to: FORK - 1, fork_below_window: false,
      mints_removed: 1, launches_removed: 1,
    }));
    expect(database.raw.prepare("SELECT tx_hash FROM launch_mints ORDER BY block_index").all().map(r => r.tx_hash))
      .toEqual(["1".repeat(64), "3".repeat(64)]);
    expect(database.raw.prepare("SELECT earned_quantity, mints, last_mint_block, last_mint_count FROM launches WHERE tx_hash = ?")
      .get(launch.tx_hash)).toEqual({ earned_quantity: "2000000000000", mints: 2, last_mint_block: 965_980, last_mint_count: 1 });
    expect(count("SELECT COUNT(*) AS n FROM launches WHERE tx_hash = ?", pending.tx_hash)).toBe(0);
    expect(database.raw.prepare("SELECT ledger_hash FROM indexed_blocks WHERE block_index IN (?, ?) ORDER BY block_index")
      .all(FORK - 1, FORK).map(r => r.ledger_hash)).toEqual([`a${FORK - 1}`, `b${FORK}`]);
    expect(count("SELECT COUNT(*) AS n FROM indexed_blocks")).toBe(12);

    // And the re-parsed ledger is then the one that stays.
    expect(await syncLaunches(database.db, metadata)).toMatchObject({ ledger_rolled_back_to: null, mints_ingested: 0 });
  });

  it("indexes on when the comparison cannot be made, and still rolls back once it can", async () => {
    const state = { reparsed: false, blocksDown: false };
    vi.stubGlobal("fetch", chain(state));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { syncLaunches } = await import("#api/indexer/sync");
    await syncLaunches(database.db, metadata);

    state.reparsed = true;
    state.blocksDown = true;
    const blind = await syncLaunches(database.db, metadata);
    expect(blind).toMatchObject({ ledger_check_failed: true, partial: true, ledger_rolled_back_to: null });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "ledger_check_failed" }));
    // Blind, the index cannot tell: the earned total did not move, so the
    // vanished mint stays and its replacement is never read.
    expect(database.raw.prepare("SELECT tx_hash FROM launch_mints ORDER BY block_index").all().map(r => r.tx_hash))
      .toEqual(["1".repeat(64), "2".repeat(64)]);

    state.blocksDown = false;
    vi.setSystemTime(NOW + 300_000);
    expect(await syncLaunches(database.db, metadata)).toMatchObject({ ledger_rolled_back_to: FORK - 1, ledger_check_failed: false });
    expect(database.raw.prepare("SELECT tx_hash FROM launch_mints ORDER BY block_index").all().map(r => r.tx_hash))
      .toEqual(["1".repeat(64), "3".repeat(64)]);
  });

  it("walks further back when the whole window changed", async () => {
    const { checkLedger } = await import("#api/indexer/ledger");
    const insert = database.raw.prepare("INSERT INTO indexed_blocks (block_index, ledger_hash, messages_hash) VALUES (?, ?, ?)");
    for (let block = TIP - 40; block <= TIP; block++) insert.run(block, `a${block}`, null);
    const deepFork = TIP - 20;
    const page = (top: number, limit: number) => Array.from({ length: limit }, (_, i) => top - i)
      .map(block => ({ block_index: block, ledger_hash: `${block >= deepFork ? "b" : "a"}${block}`, messages_hash: null }));
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      const limit = Number(url.searchParams.get("limit"));
      const cursor = url.searchParams.get("cursor");
      return Response.json({ result: page(cursor ? Number(cursor) : TIP, limit), next_cursor: null });
    });
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await checkLedger(database.db)).toMatchObject({ rolled_back_to: deepFork - 1, fork_below_window: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[1]![0]).searchParams.get("cursor")).toBe(String(TIP - 12));
    expect(database.raw.prepare("SELECT ledger_hash FROM indexed_blocks WHERE block_index = ?").get(deepFork))
      .toEqual({ ledger_hash: `b${deepFork}` });
  });
});

describe("rollbackIndexTo", () => {
  it("resets a traded asset whose event cursor passed the block to a first run", async () => {
    const raw = database.raw;
    const event = raw.prepare(`INSERT INTO asset_events (id, event, address, asset, block_index, token_delta, xcp_delta, kind)
      VALUES (?, 'x', 'addr', ?, ?, '1', '-1', 'buy')`);
    event.run("old", "FEWGOODMAN", 965_900);
    event.run("new", "FEWGOODMAN", 965_990);
    event.run("quiet", "QUIETONE", 965_800);
    const candle = raw.prepare(`INSERT INTO price_candles (id, asset, resolution, bucket_start, open, high, low, close, volume_xcp, trades, last_block)
      VALUES (?, ?, '1d', 0, '1', '1', '1', '1', '1', 1, ?)`);
    candle.run("FEWGOODMAN:1d:0", "FEWGOODMAN", 965_990);
    candle.run("QUIETONE:1d:0", "QUIETONE", 965_800);
    const state = raw.prepare("INSERT INTO chain_state (key, value) VALUES (?, ?)");
    state.run("events_hw:FEWGOODMAN", "965990");
    state.run("events_pool:FEWGOODMAN", "[1,2]");
    state.run("events_hw:QUIETONE", "965800");
    state.run("events_pool:QUIETONE", "[3,4]");

    const { rollbackIndexTo } = await import("#api/indexer/ledger");
    expect(await rollbackIndexTo(database.db, 965_950)).toMatchObject({ event_assets_reset: 1 });
    expect(raw.prepare("SELECT id FROM asset_events ORDER BY id").all().map(r => r.id)).toEqual(["old", "quiet"]);
    expect(raw.prepare("SELECT asset FROM price_candles").all().map(r => r.asset)).toEqual(["QUIETONE"]);
    expect(raw.prepare("SELECT key FROM chain_state ORDER BY key").all().map(r => r.key))
      .toEqual(["events_hw:QUIETONE", "events_pool:QUIETONE"]);
  });
});
