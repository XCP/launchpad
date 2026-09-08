import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listLaunchPage } from "#api/queries/launches";
import fixture from "./fixtures/fewgoodman-index-recovery.json";
import { apiReplayDb } from "./helpers/api-replay-db";

let database: ReturnType<typeof apiReplayDb>;
let db: D1Database;

beforeEach(() => {
  database = apiReplayDb();
  // Exercise the production SELECTs against all real schema migrations. The
  // shared replay adapter batches writes; this read-only adapter returns rows.
  db = {
    ...database.db,
    batch: async (statements: D1PreparedStatement[]) => Promise.all(statements.map((statement) => statement.all())),
  } as D1Database;
});
afterEach(() => database.raw.close());

function launch(asset: string, txIndex: number, overrides: Record<string, string | number | null> = {}) {
  const row = {
    ...fixture.launch, tx_hash: asset, tx_index: txIndex, asset, phase: "refunded", status: "closed",
    announce_block: txIndex, start_block: 1000 + txIndex, current_deadline_block: 2000 + txIndex,
    earned_quantity: "690000000000000", paid_quantity: "6900000000", minters: 3,
    pool_xcp_reserve: null, pool_token_reserve: null, pool_xcp_sats: 0, ...overrides,
  };
  const writable = new Set(database.raw.prepare("PRAGMA table_xinfo(launches)").all().filter((column) => column.hidden === 0).map((column) => column.name));
  const fields = Object.entries(row).filter(([key]) => writable.has(key));
  database.raw.prepare(`INSERT INTO launches (${fields.map(([key]) => key).join(",")}) VALUES (${fields.map(() => "?").join(",")})`)
    .run(...fields.map(([, value]) => value));
}

async function assets(sort: string, limit = 100, offset = 0) {
  const result = await listLaunchPage(db, "refunded", sort, limit, offset);
  return { ...result, assets: result.rows.map((row) => row.asset) };
}

describe("graveyard global ordering", () => {
  it("ranks retained funding progress, not the phase-dependent start-block rank", async () => {
    // Same raw historical fields the public index retains after refund:
    // settlement destroys escrow, not the append-only mint totals.
    launch("RECENTLOW", 50, { start_block: 9000, earned_quantity: "11000000000000" });
    launch("OLDERHIGH", 10, { start_block: 1000, earned_quantity: "4603100000000000" });
    launch("ZERO", 40, { start_block: 9500, earned_quantity: "0", paid_quantity: "0", minters: 0 });
    launch("EMPTY", 30, { start_block: 9900, earned_quantity: null, paid_quantity: null, minters: 0 });
    launch("NOTLISTED", 100, { conforming: 0, earned_quantity: "6800000000000000" });
    const result = await assets("progress");
    expect(result.total).toBe(4);
    expect(result.assets).toEqual(["OLDERHIGH", "RECENTLOW", "ZERO", "EMPTY"]);
    expect(result.rows[0]!.earned_quantity).toBe("4603100000000000");
  });

  it("sorts before pagination with a stable transaction-index tie break", async () => {
    launch("LOW", 40, { earned_quantity: "100000000000000" });
    launch("HIGHEARLY", 10, { earned_quantity: "4000000000000000" });
    launch("HIGHLATE", 30, { earned_quantity: "4000000000000000" });
    launch("MEDIUM", 20, { earned_quantity: "2000000000000000" });
    expect((await assets("progress", 2, 0)).assets).toEqual(["HIGHLATE", "HIGHEARLY"]);
    expect((await assets("progress", 2, 2)).assets).toEqual(["MEDIUM", "LOW"]);
  });

  it("orders Failed on by the actual deadline even when announcement order differs", async () => {
    launch("ANNOUNCEDFIRST", 10, { announce_block: 100, start_block: 500, current_deadline_block: 1500 });
    launch("ANNOUNCEDLAST", 20, { announce_block: 200, start_block: 400, current_deadline_block: 1400 });
    expect((await assets("failed")).assets).toEqual(["ANNOUNCEDFIRST", "ANNOUNCEDLAST"]);
    expect((await assets("newest")).assets).toEqual(["ANNOUNCEDLAST", "ANNOUNCEDFIRST"]);
  });

  it("orders Minters by distinct address count independently of funding and timing", async () => {
    launch("FEWADDRS", 50, { earned_quantity: "500000000000000", minters: 5 });
    launch("MANYADDRS", 10, { earned_quantity: "100000000000000", minters: 9 });
    launch("TIEDADDRS", 20, { earned_quantity: "10000000000000", minters: 9 });
    expect((await assets("minters")).assets).toEqual(["TIEDADDRS", "MANYADDRS", "FEWADDRS"]);
  });
});
