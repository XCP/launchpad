/**
 * The order the channel says things in.
 *
 * Mints sharing a block are the common case, not the corner: across every
 * launch this site has indexed, 387 of 795 mints landed in a block that held
 * another mint of the same launch, up to nine at once. Their order is not
 * cosmetic — the running "% to soft cap" is accumulated in exactly this order,
 * so two mints in the wrong order print each other's progress.
 */
import { describe, expect, it, vi } from "vitest";
import { buildBacklog } from "#api/telegram/replay";

vi.mock("#api/integrations/price", () => ({
  fetchXcpUsd: vi.fn(async () => null),
}));

const raw = (whole: bigint) => (whole * 100_000_000n).toString();

interface Rows {
  launches: Record<string, unknown>[];
  mints: Record<string, unknown>[];
  trades: Record<string, unknown>[];
}

/** Enough D1 to answer buildBacklog's four queries and nothing more. The rows
 *  come back in the order given, which is the point: SQLite makes no promise
 *  about the order of a query without an ORDER BY. */
const fakeDb = (rows: Rows) => {
  const pick = (sql: string) => {
    if (sql.includes("launch_mints")) return rows.mints;
    if (sql.includes("asset_events")) return rows.trades;
    if (sql.includes("announcement_work")) return [];
    if (sql.includes("FROM launches")) return rows.launches;
    return [];
  };
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        all: async () => ({ results: pick(sql) }),
        first: async () => pick(sql)[0] ?? null,
      }),
    }),
  } as unknown as D1Database;
};

const LAUNCH = {
  tx_hash: "launchtx",
  asset: "TESTCOIN",
  announce_block: 900,
  start_block: 901,
  phase: "minting",
  soft_cap: raw(1_000_000n),
  hard_cap: raw(10_000_000n),
  // Both mints below have been rolled into the launch total, which is what
  // seeds the running counter back to zero for this batch.
  earned_quantity: raw(300_000n),
  mints: 2,
  minters: 2,
  last_mint_block: 950,
};

/** Two mints, one block, handed over newest-first — the order a query with no
 *  ORDER BY is free to return. */
const mintsOutOfOrder = [
  {
    tx_hash: "mint-second",
    launch_tx: "launchtx",
    asset: "TESTCOIN",
    block_index: 950,
    tx_index: 5_000_002,
    source: "bc1qsecond",
    earn_quantity: raw(100_000n),
    paid_quantity: raw(1n),
    soft_cap: raw(1_000_000n),
  },
  {
    tx_hash: "mint-first",
    launch_tx: "launchtx",
    asset: "TESTCOIN",
    block_index: 950,
    tx_index: 5_000_001,
    source: "bc1qfirst",
    earn_quantity: raw(200_000n),
    paid_quantity: raw(2n),
    soft_cap: raw(1_000_000n),
  },
];

const mintItems = async (mints: Record<string, unknown>[]) => {
  const items = await buildBacklog(
    fakeDb({ launches: [LAUNCH], mints, trades: [] }),
    1_000,
  );
  return items.filter((i) => i.key.startsWith("mint:"));
};

const progressOf = (text: string) => text.match(/(\d+)% to soft cap/)?.[1] ?? null;

describe("mints sharing a block", () => {
  it("announces them in chain order, whatever order the rows arrive in", async () => {
    const items = await mintItems(mintsOutOfOrder);
    expect(items.map((i) => i.key)).toEqual(["mint:mint-first", "mint:mint-second"]);
  });

  it("gives each mint the progress that stood after it, not after the other", async () => {
    const items = await mintItems(mintsOutOfOrder);
    // 200k of a 1M soft cap, then 300k cumulative.
    expect(items.map((i) => progressOf(i.a.text))).toEqual(["20", "30"]);
  });

  it("does not depend on the order the rows happen to arrive in", async () => {
    const forward = await mintItems([...mintsOutOfOrder].reverse());
    const reversed = await mintItems(mintsOutOfOrder);
    expect(forward.map((i) => i.a.text)).toEqual(reversed.map((i) => i.a.text));
  });
});

const trade = (txHash: string, txIndex: number) => ({
  event: txHash,
  tx_hash: txHash,
  tx_index: txIndex,
  // A normal one-fill transaction is not enriched from its event list.
  event_index: 0,
  address: `address-${txHash}`,
  asset: "TESTCOIN",
  block_index: 960,
  token_delta: raw(100_000n),
  xcp_delta: raw(-1n),
  kind: "buy",
});

const tradeItems = async (trades: Record<string, unknown>[]) => {
  const items = await buildBacklog(
    fakeDb({ launches: [LAUNCH], mints: [], trades }),
    1_000,
  );
  return items.filter((i) => i.key.startsWith("trade-tx:"));
};

describe("trades sharing a block", () => {
  it("uses transaction order when ordinary fills have no event index", async () => {
    // Hash order says the opposite of chain order. Falling through to the key
    // would therefore reproduce the apparently random Telegram price path.
    const items = await tradeItems([trade("aaa-newer", 102), trade("zzz-older", 101)]);
    expect(items.map((i) => i.key)).toEqual([
      "trade-tx:zzz-older:TESTCOIN",
      "trade-tx:aaa-newer:TESTCOIN",
    ]);
  });

  it("does not depend on the order SQLite returns trade rows", async () => {
    const rows = [trade("aaa-newer", 102), trade("zzz-older", 101)];
    const forward = await tradeItems(rows);
    const reversed = await tradeItems([...rows].reverse());
    expect(forward.map((i) => i.key)).toEqual(reversed.map((i) => i.key));
  });
});
