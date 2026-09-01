import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  COUNTERPARTY_BURN_ADDRESS,
  isConfirmedAssetDestruction,
  isConfirmedBurnSend,
  reconcileBurnedSupply,
} from "#api/telegram/burns";
import type {
  CpAddressReceive,
  CpAssetDestructionEvent,
} from "#api/integrations/counterparty";

const receive = (over: Partial<CpAddressReceive> = {}): CpAddressReceive => ({
  tx_index: 200,
  tx_hash: "aa".repeat(32),
  block_index: 900_000,
  source: "SOURCE",
  destination: COUNTERPARTY_BURN_ADDRESS,
  asset: "COIN",
  quantity: "100000000000000",
  status: "valid",
  msg_index: 0,
  send_type: "send",
  ...over,
});

const destruction = (
  params: Partial<CpAssetDestructionEvent["params"]> = {},
): CpAssetDestructionEvent => ({
  event_index: 456,
  event: "ASSET_DESTRUCTION",
  tx_hash: "bb".repeat(32),
  block_index: 900_001,
  params: {
    tx_index: 201,
    tx_hash: "bb".repeat(32),
    block_index: 900_001,
    source: "SOURCE",
    asset: "COIN",
    quantity: "50000000000000",
    status: "valid",
    tag: "",
    ...params,
  },
});

describe("burn send classification", () => {
  it("accepts only a confirmed SEND to the canonical address", () => {
    expect(isConfirmedBurnSend(receive())).toBe(true);
    expect(isConfirmedBurnSend(receive({ send_type: undefined }))).toBe(false);
    expect(isConfirmedBurnSend(receive({ send_type: "fairmint" }))).toBe(false);
    expect(isConfirmedBurnSend(receive({ status: "invalid" }))).toBe(false);
    expect(isConfirmedBurnSend(receive({ destination: "SOMEWHERE_ELSE" }))).toBe(false);
    expect(isConfirmedBurnSend(receive({ quantity: "0" }))).toBe(false);
  });

  it("accepts holder destructions but rejects automatic failed-mint cleanup", () => {
    expect(isConfirmedAssetDestruction(destruction())).toBe(true);
    expect(isConfirmedAssetDestruction(destruction({ tag: "soft cap not reached" }))).toBe(false);
    expect(isConfirmedAssetDestruction(destruction({ tag: "Soft Cap Not Reached" }))).toBe(false);
    expect(isConfirmedAssetDestruction(destruction({ status: "invalid" }))).toBe(false);
    expect(isConfirmedAssetDestruction(destruction({ quantity: "0" }))).toBe(false);
    expect(isConfirmedAssetDestruction(destruction({ quantity: "not-a-number" }))).toBe(false);
  });
});

describe("burned supply reconciliation", () => {
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
        tx_hash TEXT PRIMARY KEY,
        tx_index INTEGER NOT NULL,
        asset TEXT NOT NULL,
        burned_quantity TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE token_burns (
        key TEXT PRIMARY KEY,
        tx_index INTEGER NOT NULL,
        asset TEXT NOT NULL,
        quantity TEXT NOT NULL
      )`),
      db.prepare(`CREATE TABLE chain_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`),
      db.prepare(`INSERT INTO launches VALUES
        ('old', 100, 'COIN', '999'),
        ('new', 300, 'COIN', '999'),
        ('clean', 100, 'CLEAN', '999')`),
      db.prepare(`INSERT INTO token_burns VALUES
        ('before-relaunch', 200, 'COIN', '100000000000000'),
        ('after-relaunch', 400, 'COIN', '50000000000000')`),
    ]);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("sums indexed burns after each launch and clears stale escrow-derived values", async () => {
    await reconcileBurnedSupply(db);
    const rows = await db.prepare(
      `SELECT tx_hash, burned_quantity FROM launches ORDER BY tx_hash`,
    ).all<{ tx_hash: string; burned_quantity: string }>();
    expect(rows.results).toEqual([
      { tx_hash: "clean", burned_quantity: "0" },
      { tx_hash: "new", burned_quantity: "50000000000000" },
      { tx_hash: "old", burned_quantity: "150000000000000" },
    ]);
  });
});
