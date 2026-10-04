import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/fewgoodman-index-recovery.json";
import { apiReplayDb } from "./helpers/api-replay-db";
import { CORE_ACTIVATIONS, coreVersionGate, parseCoreVersion } from "#api/indexer/core-version";
import { eligibleMintsSql, settledThrough } from "../scripts/lib/reward-eligibility.mjs";

vi.mock("#api/integrations/mempool", () => ({ fetchTxFee: async () => ({ feeSats: 100, weightWu: 400 }) }));
vi.mock("#api/integrations/price", () => ({ fetchXcpUsd: async () => null, fetchXcpUsdHistory: async () => [], historicalXcpUsdAt: () => null }));

const NOW = Date.parse("2026-09-30T16:00:00Z");
let database: ReturnType<typeof apiReplayDb>;
const metadata = { get: async () => null } as unknown as R2Bucket;
const count = (sql: string, ...binds: Array<string | number>) =>
  (database.raw.prepare(sql).get(...binds) as { n: number }).n;
const stateValue = (key: string) =>
  (database.raw.prepare("SELECT value FROM chain_state WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
function insertFixtureLaunch() {
  const writable = new Set(database.raw.prepare("PRAGMA table_xinfo(launches)").all().filter(c => c.hidden === 0).map(c => c.name));
  const entries = Object.entries(fixture.launch).filter(([key]) => writable.has(key));
  database.raw.prepare(`INSERT INTO launches (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
    .run(...entries.map(([, value]) => (typeof value === "boolean" ? Number(value) : value) as string | number | null));
}

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
    block_hash: `${reparsed && block >= FORK ? "b" : "a"}${block}`,
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

  it("pauses when the comparison cannot be made, and rolls back once it can", async () => {
    const state = { reparsed: false, blocksDown: false };
    vi.stubGlobal("fetch", chain(state));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { syncLaunches } = await import("#api/indexer/sync");
    await syncLaunches(database.db, metadata);

    state.reparsed = true;
    state.blocksDown = true;
    const blind = await syncLaunches(database.db, metadata);
    expect(blind).toMatchObject({ paused: true, written: 0, ledger_check_failed: true, partial: true, ledger_rolled_back_to: null });
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

  it("retains a pending pass when the chain changes mid-read and repairs it next tick", async () => {
    const state = {reparsed:false};
    const underlying = chain(state);
    let changeDuringPass = false;
    vi.stubGlobal("fetch", async (input:string) => {
      const response = await underlying(input);
      if (changeDuringPass && new URL(input).pathname === "/v2/fairminters") {
        state.reparsed = true; changeDuringPass = false;
      }
      return response;
    });
    vi.spyOn(console,"warn").mockImplementation(()=>{});
    const {syncLaunches} = await import("#api/indexer/sync");
    await syncLaunches(database.db,metadata);
    changeDuringPass = true;
    expect(await syncLaunches(database.db,metadata)).toMatchObject({paused:true,partial:true,ledger_check_failed:true});
    expect(stateValue("pending_index_height")).toBe(String(TIP));
    expect(await syncLaunches(database.db,metadata)).toMatchObject({paused:false,partial:false,ledger_rolled_back_to:FORK-1});
    expect(stateValue("pending_index_height")).toBeNull();
    expect(stateValue("ledger_recovery")).toBeNull();
    expect(database.raw.prepare("SELECT tx_hash FROM launch_mints ORDER BY block_index").all().map(r=>r.tx_hash)).toEqual(["1".repeat(64),"3".repeat(64)]);
  });

  it("walks further back when the whole window changed", async () => {
    const { checkLedger } = await import("#api/indexer/ledger");
    const insert = database.raw.prepare("INSERT INTO indexed_blocks (block_index, ledger_hash, messages_hash) VALUES (?, ?, ?)");
    for (let block = TIP - 40; block <= TIP; block++) insert.run(block, `a${block}`, null);
    const deepFork = TIP - 20;
    const page = (top: number, limit: number) => Array.from({ length: limit }, (_, i) => top - i)
      .map(block => ({ block_index: block, block_hash: `hash${block}`, ledger_hash: `${block >= deepFork ? "b" : "a"}${block}`, messages_hash: null }));
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
    expect(raw.prepare("SELECT key FROM chain_state WHERE key LIKE 'events_%' ORDER BY key").all().map(r => r.key))
      .toEqual(["events_hw:QUIETONE", "events_pool:QUIETONE"]);
  });

  it("drops buyers whose every buy was after the block, and keeps the rest", async () => {
    const raw = database.raw;
    const event = raw.prepare(`INSERT INTO asset_events (id, event, address, asset, block_index, token_delta, xcp_delta, kind)
      VALUES (?, 'x', ?, 'FEWGOODMAN', ?, '1', '-1', ?)`);
    event.run("early", "EARLY", 965_900, "buy");
    event.run("early-again", "EARLY", 965_990, "buy");
    event.run("late", "LATE", 965_990, "buy");
    event.run("seller", "SELLER", 965_990, "sell");
    raw.exec("INSERT INTO behavior_buyers (address) VALUES ('EARLY'), ('LATE'), ('UNTOUCHED')");

    const { rollbackIndexTo } = await import("#api/indexer/ledger");
    expect(await rollbackIndexTo(database.db, 965_950)).toMatchObject({ buyers_removed: 1 });
    expect(raw.prepare("SELECT address FROM behavior_buyers ORDER BY address").all().map(r => r.address))
      .toEqual(["EARLY", "UNTOUCHED"]);
  });

  it("removes burns after the block, restates the burned supply and count, and asks the burn scan to re-read", async () => {
    const raw = database.raw;
    insertFixtureLaunch();
    const launchTx = fixture.launch.tx_index;
    const burn = raw.prepare(`INSERT INTO token_burns (key, tx_hash, tx_index, msg_index, block_index, source, destination, asset, quantity)
      VALUES (?, ?, ?, 0, ?, 'holder', 'burn', 'FEWGOODMAN', ?)`);
    burn.run("burn:kept", "a".repeat(64), launchTx + 10, 965_940, "100");
    burn.run("burn:gone", "b".repeat(64), launchTx + 20, 965_960, "50");
    raw.prepare("UPDATE launches SET burned_quantity = '150' WHERE asset = 'FEWGOODMAN'").run();
    expect(count("SELECT burns AS n FROM burn_totals WHERE id = 1")).toBe(2);
    // History of what happened off the chain.
    raw.exec("INSERT INTO announced (key, at) VALUES ('burn:gone', 1)");
    raw.exec("INSERT INTO community_totals (id, minters, represented, creators, collectors, paid_xcp) VALUES (1, 1, 1, 1, 1, '5')");

    const { rollbackIndexTo } = await import("#api/indexer/ledger");
    const { hasCommunityRollup } = await import("#api/queries/communities");
    expect(await hasCommunityRollup(database.db)).toBe(true);
    expect(await rollbackIndexTo(database.db, 965_950)).toMatchObject({ burns_removed: 1 });
    expect(raw.prepare("SELECT key FROM token_burns").all().map(r => r.key)).toEqual(["burn:kept"]);
    expect(raw.prepare("SELECT burned_quantity FROM launches WHERE asset = 'FEWGOODMAN'").get())
      .toEqual({ burned_quantity: "100" });
    expect(count("SELECT burns AS n FROM burn_totals WHERE id = 1")).toBe(1);
    expect(stateValue("telegram_burn_rescan_from_block")).toBe("965951");
    expect(count("SELECT COUNT(*) AS n FROM announced")).toBe(1);
    expect(await hasCommunityRollup(database.db)).toBe(false);

    // A deeper rollback before the scan ran widens the re-read; a shallower one does not narrow it.
    await rollbackIndexTo(database.db, 965_900);
    await rollbackIndexTo(database.db, 965_945);
    expect(stateValue("telegram_burn_rescan_from_block")).toBe("965901");
  });
});

describe("burn scan after a rollback", () => {
  const BURN = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";
  const launchTx = fixture.launch.tx_index;
  const receive = (txIndex: number, block: number, quantity: string) => ({
    tx_index: txIndex, tx_hash: String(txIndex).padStart(64, "0"), block_index: block, source: "holder",
    destination: BURN, asset: "FEWGOODMAN", quantity, status: "valid", msg_index: 0, send_type: "send",
  });
  const destruction = (eventIndex: number, block: number, quantity: string) => ({
    event_index: eventIndex, event: "ASSET_DESTRUCTION", tx_hash: String(eventIndex).padStart(64, "e"), block_index: block,
    params: { tx_hash: String(eventIndex).padStart(64, "e"), tx_index: launchTx + 50, block_index: block, source: "holder",
      asset: "FEWGOODMAN", quantity, status: "valid", tag: "" },
  });

  it("re-reads by block from the rollback, resets both cursors below the old ones, and then clears the marker", async () => {
    const raw = database.raw;
    insertFixtureLaunch();
    raw.prepare(`INSERT INTO token_burns (key, tx_hash, tx_index, msg_index, block_index, source, destination, asset, quantity)
      VALUES ('burn:kept', ?, ?, 0, 965940, 'holder', ?, 'FEWGOODMAN', '100')`).run("a".repeat(64), launchTx + 10, BURN);
    const state = raw.prepare("INSERT INTO chain_state (key, value) VALUES (?, ?)");
    state.run("burned_supply_from_chain_events_seeded", "1");
    // Cursors from the chain before the re-parse: higher than anything the node now has.
    state.run("telegram_burn_receive_tx_index", String(launchTx + 900));
    state.run("telegram_asset_destruction_event_index", "90000");
    state.run("telegram_burn_rescan_from_block", "965951");

    const receives = [receive(launchTx + 40, 965_960, "70"), receive(launchTx + 10, 965_940, "100")];
    const destructions = [destruction(80_000, 965_955, "5"), destruction(70_000, 965_900, "9")];
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      const limit = Number(url.searchParams.get("limit"));
      if (url.pathname === `/v2/addresses/${BURN}/receives`) return Response.json({ result: receives.slice(0, limit), next_cursor: null });
      if (url.pathname === "/v2/events/ASSET_DESTRUCTION") return Response.json({ result: destructions.slice(0, limit), next_cursor: null });
      throw new Error(`unexpected read ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const { advanceBurnCursor, scanBurnReceives } = await import("#api/telegram/burns");
    const scan = await scanBurnReceives(database.db);
    expect(scan).toMatchObject({ nextCursor: launchTx + 40, nextDestructionCursor: 80_000, rescanFrom: 965_951 });
    expect(scan.announcements.map(a => a.key)).toEqual([
      `burn:${receive(launchTx + 40, 0, "").tx_hash}:0:FEWGOODMAN`,
      "destroy:80000:FEWGOODMAN",
    ]);
    expect(raw.prepare("SELECT key FROM token_burns ORDER BY block_index").all().map(r => r.key)).toEqual([
      "burn:kept", "destroy:80000:FEWGOODMAN", `burn:${receive(launchTx + 40, 0, "").tx_hash}:0:FEWGOODMAN`,
    ]);
    expect(raw.prepare("SELECT burned_quantity FROM launches WHERE asset = 'FEWGOODMAN'").get())
      .toEqual({ burned_quantity: "175" });

    await advanceBurnCursor(database.db, scan.nextCursor, scan.nextDestructionCursor, scan.rescanFrom);
    expect(stateValue("telegram_burn_receive_tx_index")).toBe(String(launchTx + 40));
    expect(stateValue("telegram_asset_destruction_event_index")).toBe("80000");
    expect(stateValue("telegram_burn_rescan_from_block")).toBeNull();

    // Back to normal: monotonic, and nothing re-read below the cursor.
    await advanceBurnCursor(database.db, launchTx + 1, 1);
    expect(stateValue("telegram_burn_receive_tx_index")).toBe(String(launchTx + 40));
    fetch.mockClear();
    const quiet = await scanBurnReceives(database.db);
    expect(quiet).toMatchObject({ announcements: [], rescanFrom: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a marker a second rollback moved while the scan ran", async () => {
    database.raw.prepare("INSERT INTO chain_state (key, value) VALUES ('telegram_burn_rescan_from_block', '965901')").run();
    const { advanceBurnCursor } = await import("#api/telegram/burns");
    await advanceBurnCursor(database.db, 5, 6, 965_951);
    expect(stateValue("telegram_burn_rescan_from_block")).toBe("965901");
  });
});

describe("reward eligibility", () => {
  it("counts only mints six confirmations deep, in the programme's order", () => {
    const raw = database.raw;
    insertFixtureLaunch();
    const TIP = 970_000;
    expect(settledThrough(TIP)).toBe(969_995);
    const mint = raw.prepare(`INSERT INTO launch_mints (tx_hash, launch_tx, block_index, source, earn_quantity, paid_quantity, tx_index)
      VALUES (?, ?, ?, ?, '1', '1', ?)`);
    mint.run("c".repeat(64), fixture.launch.tx_hash, 969_990, "third", 3);
    mint.run("a".repeat(64), fixture.launch.tx_hash, 969_980, "first", 1);
    mint.run("b".repeat(64), fixture.launch.tx_hash, 969_995, "six-deep", 2);
    mint.run("d".repeat(64), fixture.launch.tx_hash, 969_996, "five-deep", 4);
    mint.run("e".repeat(64), fixture.launch.tx_hash, TIP, "tip", 5);
    const sources = (cutoff: number, tip: number) =>
      raw.prepare(eligibleMintsSql(cutoff, tip)).all().map(r => r.source);
    expect(sources(10, TIP)).toEqual(["first", "third", "six-deep"]);
    // Fewer than the cutoff: the script refuses rather than reach for shallow mints.
    expect(sources(4, TIP)).toHaveLength(3);
    expect(sources(4, TIP + 1)).toEqual(["first", "third", "six-deep", "five-deep"]);
    expect(() => eligibleMintsSql(10, Number.NaN)).toThrow();
    expect(() => eligibleMintsSql(0, TIP)).toThrow();
  });
});
