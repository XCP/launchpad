import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/fewgoodman-index-recovery.json";
import { apiReplayDb } from "./helpers/api-replay-db";

const NOW = Date.parse("2026-09-07T22:00:00Z");
let database: ReturnType<typeof apiReplayDb>;
const target = [{ asset: "FEWGOODMAN", poolRevision: JSON.stringify([fixture.launch.pool_xcp_reserve, fixture.launch.pool_token_reserve]) }];
const rows = () => database.raw.prepare("SELECT * FROM asset_events ORDER BY id").all();
const candles = () => database.raw.prepare("SELECT * FROM price_candles ORDER BY id").all();
const markers = () => database.raw.prepare("SELECT key,value FROM chain_state WHERE key >= 'events_' ORDER BY key").all();

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  database = apiReplayDb();
  const writable = new Set(database.raw.prepare("PRAGMA table_xinfo(launches)").all().filter(c => c.hidden === 0).map(c => c.name));
  const entries = Object.entries(fixture.launch).filter(([key]) => writable.has(key));
  database.raw.prepare(`INSERT INTO launches (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map(() => "?").join(",")})`)
    .run(...entries.map(([,value]) => value));
});
afterEach(() => { database.raw.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a refused event feed is observable and recoverable on the next allowed pass", () => {
  it.each(["first-page", "later-page", "enrichment"])("recovers actual FEWGOODMAN rows/candles without advancing unread markers (%s429)", async failureAt => {
    let throttled = true;
    const cancel = vi.fn();
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.includes("/pools/FEWGOODMAN/XCP/matches")) {
        if (throttled && failureAt !== "enrichment" && (failureAt === "first-page" || url.searchParams.has("cursor"))) {
          return new Response(new ReadableStream({ cancel }), { status: 429, headers: { "retry-after": "120" } });
        }
        if (throttled && failureAt === "later-page") return Response.json({ result: fixture.pool.slice(0, 1), next_cursor: 123 });
        return Response.json({ result: fixture.pool, next_cursor: null });
      }
      if (url.pathname.includes("/orders/FEWGOODMAN/XCP/matches")) return Response.json({ result: fixture.book, next_cursor: null });
      if (url.pathname.includes("/transactions/")) {
        if (throttled && failureAt === "enrichment") return new Response(new ReadableStream({ cancel }), { status: 429, headers: { "retry-after": "120" } });
        return Response.json({ result: fixture.events });
      }
      throw new Error(`No fixture for ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const { syncAssetEvents } = await import("#api/indexer/events");
    const { runScheduledJob } = await import("#api/scheduler/job");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const successLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const failed = { failed: 0, deferred: 0 };
    await runScheduledJob("sync_launches", async () => ({
      events_ingested: await syncAssetEvents(database.db, target, 965977, failed),
      event_assets_failed: failed.failed, event_assets_deferred: failed.deferred,
      partial: failed.failed + failed.deferred > 0,
    }));
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ outcome: "partial", progress: expect.objectContaining({ event_assets_failed: 1 }) }));
    expect(successLog).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    expect(candles()).toEqual([]);
    expect(markers()).toEqual([]);
    expect(cancel).toHaveBeenCalledOnce();
    const countAfterRefusal = fetch.mock.calls.length;

    const deferred = { failed: 0, deferred: 0 };
    expect(await syncAssetEvents(database.db, target, 965977, deferred)).toBe(0);
    expect(deferred).toEqual({ failed: 0, deferred: 1 });
    expect(fetch).toHaveBeenCalledTimes(countAfterRefusal);
    expect(markers()).toEqual([]);

    vi.setSystemTime(NOW + 120_000);
    throttled = false;
    const recovered = { failed: 0, deferred: 0 };
    expect(await syncAssetEvents(database.db, target, 965977, recovered)).toBe(16);
    expect(recovered).toEqual({ failed: 0, deferred: 0 });
    expect(rows().filter(row => row.primary_actor === 1)).toHaveLength(15);
    expect(database.raw.prepare("SELECT volume_xcp,trades,last_block FROM price_candles WHERE id='FEWGOODMAN:1d:1788739200'").get())
      .toMatchObject({ volume_xcp: "21705101270", trades: 15, last_block: 965971 });
    expect(markers()).toEqual([
      { key: "events_hw:FEWGOODMAN", value: "965971" },
      { key: "events_pool:FEWGOODMAN", value: target[0]!.poolRevision },
    ]);
    const stable = { rows: rows(), candles: candles(), markers: markers() };
    expect(await syncAssetEvents(database.db, target, 965977)).toBe(0);
    expect({ rows: rows(), candles: candles(), markers: markers() }).toEqual(stable);
  });

  it("reports a failed quiet-book probe without calling the pair unchanged", async () => {
    database.raw.prepare("INSERT INTO chain_state VALUES ('events_hw:FEWGOODMAN','965963'),('events_pool:FEWGOODMAN',?)").run(target[0]!.poolRevision);
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const { syncAssetEvents } = await import("#api/indexer/events");
    const progress = { failed: 0, deferred: 0 };
    expect(await syncAssetEvents(database.db, target, 965977, progress)).toBe(0);
    expect(progress).toEqual({ failed: 1, deferred: 0 });
    expect(markers()[0]).toEqual({ key: "events_hw:FEWGOODMAN", value: "965963" });
    expect(rows()).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
