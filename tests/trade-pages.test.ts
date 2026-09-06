import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  countTradesByAsset,
  listRecentTrades,
} from "#api/queries/activity";

describe("per-asset trade pages", () => {
  let mf: Miniflare;
  let db: D1Database;

  beforeEach(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: `export default { fetch() { return new Response("ok") } }`,
        d1Databases: ["DB"],
      }),
    );
    db = await mf.getD1Database("DB");
    await db.batch([
      db.prepare(`CREATE TABLE launches (
        asset TEXT PRIMARY KEY,
        divisible INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE asset_events (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        address TEXT NOT NULL,
        asset TEXT NOT NULL,
        block_index INTEGER NOT NULL,
        token_delta TEXT NOT NULL,
        xcp_delta TEXT NOT NULL,
        kind TEXT NOT NULL,
        tx_hash TEXT,
        event_index INTEGER,
        primary_actor INTEGER NOT NULL,
        tx_index INTEGER NOT NULL,
        counterparty_address TEXT
      )`),
      db.prepare(`INSERT INTO launches VALUES ('COIN', 1), ('OTHER', 1)`),
    ]);

    const insert = db.prepare(`INSERT INTO asset_events VALUES
      (?1, ?2, 'TRADER', ?3, ?4, '100', '-10', 'buy', ?2, 0, ?5, ?4, ?6)`);
    await db.batch([
      ...Array.from({ length: 60 }, (_, i) => {
        const n = i + 1;
        return insert.bind(`coin-${n}`, `tx-${n}`, "COIN", 100 + n, 1, null);
      }),
      insert.bind("other", "tx-other", "OTHER", 999, 1, null),
      // A book fill: the taker's row names the resting maker, and the
      // maker-side bookkeeping row is not a second trade.
      insert.bind("book-taker", "tx-book", "COIN", 997, 1, "MAKER"),
      insert.bind("maker", "tx-book", "COIN", 997, 0, "TRADER"),
    ]);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("names the resting maker on a book fill and nobody on a pool fill", async () => {
    const newest = await listRecentTrades(db, 2, 0, "COIN");
    expect(newest.map((row) => [row.event, row.counterparty_address])).toEqual([
      ["tx-book", "MAKER"],
      ["tx-60", null],
    ]);
  });

  it("retrieves rows beyond the old 50-trade ceiling", async () => {
    expect(await countTradesByAsset(db, "COIN")).toBe(61);
    const thirdPage = await listRecentTrades(db, 25, 50, "COIN");
    expect(thirdPage).toHaveLength(11);
    expect(thirdPage.map((row) => row.block_index)).toEqual([
      111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101,
    ]);
  });
});
