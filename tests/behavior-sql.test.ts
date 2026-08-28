import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  behaviorRollupIsStale,
  refreshBehaviorRollup,
} from "#api/indexer/behavior-rollup";
import {
  getBehaviorCohorts,
  listLaunchBehavior,
} from "#api/queries/behavior";
import { listConformingAssetsAmong } from "#api/queries/launches";

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
  const statements = [
    `CREATE TABLE launches (
      tx_hash TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      conforming INTEGER,
      last_mint_block INTEGER,
      phase TEXT NOT NULL
    )`,
    `CREATE TABLE launch_mints (
      tx_hash TEXT PRIMARY KEY,
      launch_tx TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      source TEXT NOT NULL,
      earn_quantity TEXT NOT NULL,
      paid_quantity TEXT NOT NULL
    )`,
    `CREATE TABLE asset_events (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      asset TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      token_delta TEXT NOT NULL,
      xcp_delta TEXT NOT NULL,
      kind TEXT NOT NULL
    )`,
    `CREATE INDEX idx_asset_events_asset_address
      ON asset_events(asset, address, block_index)`,
    `CREATE TABLE behavior_settings (
      id INTEGER PRIMARY KEY,
      fast_exit_blocks INTEGER NOT NULL
    )`,
    `INSERT INTO behavior_settings VALUES (1, 6)`,
    `CREATE TABLE behavior_wallets (
      address TEXT PRIMARY KEY,
      minted_launches INTEGER NOT NULL,
      holding_launches INTEGER NOT NULL,
      traded_launches INTEGER NOT NULL,
      immediate_dump_launches INTEGER NOT NULL,
      later_dump_launches INTEGER NOT NULL,
      exited_launches INTEGER NOT NULL,
      graduated_launches INTEGER NOT NULL DEFAULT 0,
      graduated_no_sale_launches INTEGER NOT NULL DEFAULT 0,
      sold_launches INTEGER NOT NULL DEFAULT 0,
      seller_remaining_launches INTEGER NOT NULL DEFAULT 0,
      redeployed_after_sale INTEGER NOT NULL DEFAULT 0,
      redeployed_paid_raw TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX idx_behavior_wallets_fast
      ON behavior_wallets(immediate_dump_launches DESC, minted_launches DESC, address)`,
    `CREATE TABLE behavior_buyers (address TEXT PRIMARY KEY)`,
    `CREATE TABLE behavior_totals (
      id INTEGER PRIMARY KEY,
      minter_addresses INTEGER NOT NULL,
      mint_and_holding INTEGER NOT NULL,
      mint_and_trading INTEGER NOT NULL,
      immediate_dumpers INTEGER NOT NULL,
      later_dumpers INTEGER NOT NULL,
      buyers INTEGER NOT NULL,
      graduated_minter_addresses INTEGER NOT NULL DEFAULT 0,
      graduated_never_sold INTEGER NOT NULL DEFAULT 0,
      seller_addresses INTEGER NOT NULL DEFAULT 0,
      redeploy_and_hold INTEGER NOT NULL DEFAULT 0,
      redeploy_and_exit INTEGER NOT NULL DEFAULT 0,
      hold_without_redeploy INTEGER NOT NULL DEFAULT 0,
      exit_without_redeploy INTEGER NOT NULL DEFAULT 0,
      redeployed_paid_raw TEXT NOT NULL DEFAULT '0',
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE behavior_launch_balances (
      asset TEXT PRIMARY KEY,
      held_without_sale INTEGER NOT NULL,
      moved_without_sale INTEGER NOT NULL,
      sellers_holding INTEGER NOT NULL,
      seller_balance_raw TEXT NOT NULL,
      fast_sellers_holding INTEGER NOT NULL,
      fast_seller_balance_raw TEXT NOT NULL,
      dispenser_sellers INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `INSERT INTO launches VALUES ('launch', 'COIN', 1, 200, 'graduated')`,
    `INSERT INTO launch_mints VALUES
      ('m1', 'launch', 100, 'EARLY', '10000000000', '10'),
      ('m2', 'launch', 199, 'LATE', '10000000000', '10'),
      ('m3', 'launch', 150, 'HOLD', '10000000000', '10'),
      ('m4', 'launch', 180, 'TRADER', '10000000000', '10')`,
    `INSERT INTO asset_events VALUES
      ('e1', 'EARLY', 'COIN', 201, '-10000000000', '10', 'sell'),
      ('e2', 'LATE', 'COIN', 207, '-10000000000', '11', 'sell'),
      ('e3', 'TRADER', 'COIN', 201, '5000000000', '-5', 'buy'),
      ('e4', 'TRADER', 'COIN', 202, '-2000000000', '2', 'sell'),
      ('e5', 'BUYER', 'COIN', 203, '7500000000', '-10', 'buy')`,
    `INSERT INTO behavior_buyers
      SELECT DISTINCT address FROM asset_events WHERE kind = 'buy'`,
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));
});

afterEach(async () => {
  await mf.dispose();
});

describe("wallet behavior SQL", () => {
  it("checks only the launch assets present in the mempool", async () => {
    await db.batch([
      db.prepare(`INSERT INTO launches VALUES ('other', 'OTHER', 1, 200, 'graduated')`),
      db.prepare(`INSERT INTO launches VALUES ('hidden', 'HIDDEN', 0, 200, 'graduated')`),
    ]);

    expect(
      await listConformingAssetsAmong(db, ["COIN", "COIN", "HIDDEN", "MISSING"]),
    ).toEqual(["COIN"]);
    expect(await listConformingAssetsAmong(db, [])).toEqual([]);
  });

  it("anchors fast exits to graduation, not an address's first mint", async () => {
    const rows = await listLaunchBehavior(db, ["COIN"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asset: "COIN",
      tracked_minters: 4,
      holding_signal: 1,
      minter_traders: 1,
      immediate_dumpers: 2,
      later_dumpers: 1,
      dumpers_exited: 2,
      dumpers_remaining: 1,
      dumper_overhang: "13000000000",
      fast_dumpers_exited: 1,
      fast_dumpers_remaining: 1,
      fast_dumper_overhang: "13000000000",
      known_fast_minters: 0,
      known_fast_inventory: "0",
      repeat_dump_minters: 0,
      repeat_dump_inventory: "0",
      held_without_sale: 1,
      moved_without_sale: 0,
      sellers_holding: 1,
      seller_balance_raw: "13000000000",
      fast_sellers_holding: 1,
      fast_seller_balance_raw: "13000000000",
      buyers: 2,
      buyer_only: 1,
      bought_xcp: "15",
      sold_xcp: "23",
    });

    // EARLY minted 100 blocks before graduation but sold one block after it.
    // A first-mint baseline would call that late; the market-opening baseline
    // correctly counts it among the two immediate dumpers.
  });

  it("scores active minters by fast-sale history and current allocation", async () => {
    await refreshBehaviorRollup(db);
    await db.batch([
      db.prepare(`INSERT INTO launches VALUES ('new-launch', 'NEW', 1, NULL, 'minting')`),
      db.prepare(`INSERT INTO launch_mints VALUES
        ('n1', 'new-launch', 210, 'EARLY', '7000000000', '7'),
        ('n2', 'new-launch', 211, 'HOLD', '3000000000', '3')`),
    ]);

    const [row] = await listLaunchBehavior(db, ["NEW"]);
    expect(row).toMatchObject({
      tracked_minters: 2,
      immediate_dumpers: 0,
      later_dumpers: 0,
      known_fast_minters: 1,
      known_fast_inventory: "7000000000",
    });
  });

  it("partitions sellers by redeployment and remaining inventory", async () => {
    await db.batch([
      db.prepare(`INSERT INTO launches VALUES ('new-launch', 'NEW', 1, NULL, 'minting')`),
      db.prepare(`INSERT INTO launch_mints VALUES
        ('n1', 'new-launch', 210, 'EARLY', '7000000000', '7')`),
    ]);
    await refreshBehaviorRollup(db);

    expect(await getBehaviorCohorts(db)).toMatchObject({
      seller_addresses: 3,
      redeploy_and_hold: 0,
      redeploy_and_exit: 1,
      hold_without_redeploy: 1,
      exit_without_redeploy: 1,
      redeployed_paid_raw: "7",
    });
  });

  it("treats one token or one percent remaining as exit dust", async () => {
    await db.batch([
      db.prepare(`INSERT INTO launches VALUES ('dust-launch', 'DUST', 1, 300, 'graduated')`),
      db.prepare(`INSERT INTO launch_mints VALUES
        ('d1', 'dust-launch', 250, 'SUBTOKEN', '10000000000', '1'),
        ('d2', 'dust-launch', 251, 'HALFPCT', '1000000000000', '1'),
        ('d3', 'dust-launch', 252, 'TWOPCT', '1000000000000', '1')`),
      db.prepare(`INSERT INTO asset_events VALUES
        ('de1', 'SUBTOKEN', 'DUST', 301, '-9950000000', '1', 'sell'),
        ('de2', 'HALFPCT', 'DUST', 301, '-995000000000', '1', 'sell'),
        ('de3', 'TWOPCT', 'DUST', 301, '-980000000000', '1', 'sell')`),
    ]);

    expect((await listLaunchBehavior(db, ["DUST"]))[0]).toMatchObject({
      fast_dumpers_exited: 2,
      fast_dumpers_remaining: 1,
      fast_dumper_overhang: "20000000000",
    });
  });

  it("materializes cohorts and serves them without folding raw history", async () => {
    const refreshed = await refreshBehaviorRollup(db);
    // Miniflare reports cumulative rows_written metadata within a D1 batch;
    // the material fact here is that the four rows were populated.
    expect(refreshed.wallets_written).toBeGreaterThan(0);
    expect(refreshed.totals_written).toBe(1);

    const cohorts = await getBehaviorCohorts(db);
    expect(cohorts).toMatchObject({
      minter_addresses: 4,
      mint_and_holding: 1,
      mint_and_trading: 1,
      immediate_dumpers: 2,
      later_dumpers: 1,
      buyers: 2,
      graduated_minter_addresses: 4,
      graduated_never_sold: 1,
      seller_addresses: 3,
      redeploy_and_hold: 0,
      redeploy_and_exit: 0,
      hold_without_redeploy: 1,
      exit_without_redeploy: 2,
      redeployed_paid_raw: "0",
      fast_exit_blocks: 6,
    });
    expect(cohorts.repeat_fast).toEqual([]);

    // A second authoritative recompute finds identical rows and writes none.
    expect(await refreshBehaviorRollup(db)).toEqual({
      wallets_written: 0,
      totals_written: 0,
    });

    await db
      .prepare(`UPDATE behavior_wallets SET immediate_dump_launches = 2 WHERE address = 'EARLY'`)
      .run();
    expect((await getBehaviorCohorts(db)).repeat_fast.map((row) => row.address)).toEqual([
      "EARLY",
    ]);
    expect((await getBehaviorCohorts(db)).repeat_fast[0]?.graduated_no_sale_launches).toBe(0);
  });

  it("skips the historical fold on a quiet indexer tick", () => {
    expect(
      behaviorRollupIsStale({
        mintsIngested: 0,
        eventsIngested: 0,
        resolved: 0,
        graduations: 0,
      }),
    ).toBe(false);
    expect(
      behaviorRollupIsStale({
        mintsIngested: 0,
        eventsIngested: 1,
        resolved: 0,
        graduations: 0,
      }),
    ).toBe(true);
  });
});
