import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { syncAssetEvents } from "#api/indexer/events";

const upstream = vi.hoisted(() => ({ pool: vi.fn(), book: vi.fn(), newest: vi.fn() }));
vi.mock("#api/integrations/counterparty", () => ({
  fetchPoolMatches: upstream.pool, fetchOrderMatches: upstream.book,
  fetchNewestOrderMatchBlock: upstream.newest, fetchTransactionEvents: async () => [],
}));
let mf: Miniflare;
let db: D1Database;
beforeEach(async () => {
  vi.clearAllMocks(); upstream.book.mockResolvedValue([]); upstream.newest.mockResolvedValue(null);
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: `export default { fetch() { return new Response("ok") } }`, d1Databases: ["DB"] }));
  db = await mf.getD1Database("DB");
  await db.batch([
    db.prepare("CREATE TABLE chain_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare("CREATE TABLE behavior_buyers (address TEXT PRIMARY KEY)"),
    db.prepare(`CREATE TABLE asset_events (id TEXT PRIMARY KEY, event TEXT, address TEXT, asset TEXT,
      block_index INTEGER, token_delta TEXT, xcp_delta TEXT, kind TEXT, tx_hash TEXT,
      tx_index INTEGER, event_index INTEGER, primary_actor INTEGER, counterparty_address TEXT)`),
    db.prepare("INSERT INTO chain_state VALUES ('events_hw:FEWGOODMAN', '965945')"),
  ]);
});
afterEach(async () => { await mf.dispose(); });
describe("event ingestion acknowledges only completed reserve snapshots", () => {
  it.each([false, true])("retries an unchanged launch snapshot after a feed failure (prior marker: %s)", async markerExists => {
    if (markerExists) await db.prepare("INSERT INTO chain_state VALUES ('events_pool:FEWGOODMAN', 'old')").run();
    const targets = [{ asset: "FEWGOODMAN", poolRevision: '["53314898730","4018904691728146"]' }];
    upstream.pool.mockRejectedValueOnce(new Error("HTTP 429"));
    expect(await syncAssetEvents(db, targets, 965963)).toBe(0);
    expect(await db.prepare("SELECT value FROM chain_state WHERE key = 'events_hw:FEWGOODMAN'").first("value")).toBe("965945");
    expect(await db.prepare("SELECT value FROM chain_state WHERE key = 'events_pool:FEWGOODMAN'").first("value")).toBe(markerExists ? "old" : null);
    // Launch sync has already stored these same reserves. No further market
    // movement occurs, but the failed ingestion still must retry.
    upstream.pool.mockResolvedValueOnce([{
      tx_hash: "946763988baefcdace10d0088fb07430579e6a6bb971d47b3c6af6fe5de7bf17",
      tx_index: 3183074, block_index: 965963, source: "trader", status: "valid",
      forward_asset: "FEWGOODMAN", forward_quantity: "100729766778896",
      backward_asset: "XCP", backward_quantity: "1310000000",
    }]);
    expect(await syncAssetEvents(db, targets, 965963)).toBeGreaterThan(0);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM asset_events").first("n")).toBe(1);
    expect(upstream.pool).toHaveBeenCalledTimes(2);
    expect(await db.prepare("SELECT token_delta FROM asset_events").first("token_delta")).toBe("100729766778896");
    expect(await db.prepare("SELECT value FROM chain_state WHERE key = 'events_pool:FEWGOODMAN'").first("value")).toBe(targets[0]!.poolRevision);
    expect(await syncAssetEvents(db, targets, 965963)).toBe(0);
    expect(upstream.pool).toHaveBeenCalledTimes(2);
  });
});
