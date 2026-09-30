import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiReplayDb } from "./helpers/api-replay-db";

/**
 * Core returns open orders that never expire as expiration = 0 with
 * expire_index = null. One such order used to fail its market's whole write
 * (orders.expire_index was NOT NULL), leaving that book stale.
 */

const MIGRATIONS = fileURLToPath(new URL("../apps/api/migrations", import.meta.url));
const REBUILD = "0040_nullable_order_expire_index.sql";
const ASSET = "KILLERAPP";
const NEVER = "60919a4b02e8fe63af9d56ad9316f5dcc1087d771dbae45760d5e9d517b6a6de";
const EXPIRING = "ab".repeat(32);

function coreOrder(txHash: string, txIndex: number, expiration: number, expireIndex: number | null) {
  return {
    tx_hash: txHash, tx_index: txIndex, block_index: 968818, source: "1Source",
    give_asset: "XCP", give_quantity: 100000000, give_remaining: 100000000,
    get_asset: ASSET, get_quantity: 500000000000, get_remaining: 500000000000,
    expiration, expire_index: expireIndex, status: "open",
  };
}

const ORDER_COLUMNS = `tx_hash, tx_index, block_index, source, asset, side, token_quantity,
  xcp_quantity, expire_index, token_remaining, xcp_remaining, status, updated_at`;

describe(`migration ${REBUILD}`, () => {
  it("makes expire_index nullable and keeps every row, column and index", () => {
    const db = new DatabaseSync(":memory:");
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe(REBUILD);
    for (const file of files.slice(0, -1)) db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));

    const columnsBefore = db.prepare("PRAGMA table_info(orders)").all();
    const indexSql = () => db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'orders' AND sql IS NOT NULL ORDER BY name")
      .all()
      // Line endings follow the checkout, not the schema.
      .map((i) => ({ name: i.name, sql: String(i.sql).replace(/\s+/g, " ") }));
    const indexesBefore = indexSql();
    expect(indexesBefore.map((i) => i.name)).toEqual(["idx_orders_open", "idx_orders_recent"]);

    const insert = `INSERT INTO orders (${ORDER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const existing = [
      ["aa".repeat(32), 10, 968000, "1A", ASSET, "buy", "500000000000", "100000000", 969000, "0", "0", "filled", 1],
      ["bb".repeat(32), 11, 968001, "1B", ASSET, "sell", "10000000000000000", "300000000", 969001, "10000000000000000", "300000000", "open", 2],
    ];
    for (const row of existing) db.prepare(insert).run(...row);
    expect(() => db.prepare(insert).run("cc".repeat(32), 12, 968002, "1C", ASSET, "buy", "1", "1", null, "1", "1", "open", 3))
      .toThrow(/NOT NULL constraint failed: orders.expire_index/);

    db.exec(readFileSync(join(MIGRATIONS, REBUILD), "utf8"));

    expect(db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders ORDER BY tx_index`).all().map((r) => Object.values(r)))
      .toEqual(existing);
    const columnsAfter = db.prepare("PRAGMA table_info(orders)").all();
    expect(columnsAfter).toEqual(columnsBefore.map((c) => (c.name === "expire_index" ? { ...c, notnull: 0 } : c)));
    expect(indexSql()).toEqual(indexesBefore);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'orders_new'").all()).toEqual([]);

    db.prepare(insert).run("cc".repeat(32), 12, 968002, "1C", ASSET, "buy", "1", "1", null, "1", "1", "open", 3);
    expect(db.prepare("SELECT expire_index FROM orders WHERE tx_index = 12").get()).toEqual({ expire_index: null });
    // Every other column is still required.
    expect(() => db.prepare(insert).run("dd".repeat(32), 13, 968003, "1D", ASSET, "buy", "1", "1", null, "1", "1", null, 4))
      .toThrow(/NOT NULL constraint failed: orders.status/);
    db.close();
  });
});

describe("an order that never expires", () => {
  let database: ReturnType<typeof apiReplayDb>;

  beforeEach(() => {
    vi.resetModules();
    database = apiReplayDb();
    const book = [
      coreOrder(NEVER, 3190001, 0, null),
      coreOrder(EXPIRING, 3190000, 1000, 969818),
      // Defensive: an expiring order without expire_index is still dated.
      coreOrder("cd".repeat(32), 3189999, 144, null),
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith(`/assets/${ASSET}/orders`)) return Response.json({ result: book, next_cursor: null });
      throw new Error(`No fixture for ${url}`);
    }));
    vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => undefined } });
  });
  afterEach(() => { database.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("is mirrored with a null expire_index and the market's digest is stored", async () => {
    const { syncOrders } = await import("#api/indexer/orders");
    const result = await syncOrders(database.db, [ASSET]);
    expect(result).toMatchObject({ markets_read: 1, markets_changed: 1, rows_written: 3, failed: 0 });
    expect(database.raw.prepare("SELECT tx_hash, expire_index, status FROM orders ORDER BY tx_index DESC").all()).toEqual([
      { tx_hash: NEVER, expire_index: null, status: "open" },
      { tx_hash: EXPIRING, expire_index: 969818, status: "open" },
      { tx_hash: "cd".repeat(32), expire_index: 968818 + 144, status: "open" },
    ]);
    expect(database.raw.prepare("SELECT value FROM chain_state WHERE key = ?").get(`orders_digest:${ASSET}`)).toBeTruthy();

    // The next tick finds nothing new and writes nothing.
    expect(await syncOrders(database.db, [ASSET])).toMatchObject({ markets_changed: 0, rows_written: 0 });
  });

  it("is served as open, in the live book, with expire_index null", async () => {
    const { syncOrders } = await import("#api/indexer/orders");
    await syncOrders(database.db, [ASSET]);
    const { activityRoute } = await import("#api/read/activity");
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
    for (const live of [false, true]) {
      const res = await activityRoute.request(`https://api.test/v2/activity/orders${live ? "?live=1" : ""}`, {}, { DB: database.db }, ctx);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: Array<{ tx_hash: string; state: string; expire_index: number | null }>; total: number };
      expect(body.total).toBe(3);
      expect(body.result.find((o) => o.tx_hash === NEVER)).toMatchObject({ state: "open", expire_index: null });
      expect(body.result.find((o) => o.tx_hash === EXPIRING)).toMatchObject({ state: "open", expire_index: 969818 });
    }
  });

  it("reaches the web app as expireBlock null, never a number", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      result: [
        { tx_hash: NEVER, asset: ASSET, source: "1Source", side: "buy", state: "open", block_index: 968818, expire_index: null,
          token_quantity: "500000000000", xcp_quantity: "100000000", token_remaining: "500000000000", xcp_remaining: "100000000", filled: 0, divisible: 1 },
        { tx_hash: EXPIRING, asset: ASSET, source: "1Source", side: "buy", state: "open", block_index: 968818, expire_index: 969818,
          token_quantity: "500000000000", xcp_quantity: "100000000", token_remaining: "500000000000", xcp_remaining: "100000000", filled: 0, divisible: 1 },
      ],
      total: 2,
    })));
    const { fetchActivityOrders } = await import("@/lib/api/launchpad-api");
    const page = await fetchActivityOrders(50, true);
    expect(page?.rows.map((r) => [r.txHash, r.state, r.expireBlock])).toEqual([
      [NEVER, "open", null],
      [EXPIRING, "open", 969818],
    ]);
  });
});
