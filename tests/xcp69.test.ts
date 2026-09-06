import { describe, expect, it } from "vitest";
import {
  circulatingSupplyRaw,
  remainingLotsForAddress,
  announcedBeforeStart,
  isXcp69,
  launchPhase,
  saleProgress,
  saleTarget,
  windowIsExact,
  XCP69,
  XCP69_EXACT,
  XCP69_MIN_PARTICIPANTS,
  XCP69_RAISE_SATS,
  xcp69Params,
  type Fairminter,
} from "@launchpad/xcp69/xcp69";

/**
 * A launch that conforms in every respect. Every test below takes this and
 * breaks exactly one thing — because an exact-equality policy is only worth
 * as much as its proof that it REJECTS near-misses. A test suite that only
 * checks the happy path would pass just as well against `return true`.
 */
const START = 900_000;
const conforming = (over: Partial<Fairminter> = {}): Fairminter => ({
  tx_hash: "aa".repeat(32),
  tx_index: 1,
  block_index: START - 36, // announced 36 blocks before it opens
  source: "1SomeCreatorAddress",
  asset: "TESTCOIN",
  asset_longname: null,
  description: "https://xcp.fun/TESTCOIN.json",
  price: String(XCP69_EXACT.PRICE),
  quantity_by_price: String(XCP69_EXACT.QUANTITY_BY_PRICE),
  hard_cap: String(XCP69_EXACT.HARD_CAP),
  soft_cap: String(XCP69_EXACT.SOFT_CAP),
  soft_cap_deadline_block: START + XCP69.DEADLINE_BLOCKS,
  start_block: START,
  end_block: 0,
  burn_payment: false,
  max_mint_per_tx: String(XCP69_EXACT.MAX_MINT_PER_TX),
  max_mint_per_address: String(XCP69_EXACT.MAX_MINT_PER_ADDRESS),
  premint_quantity: "0",
  minted_asset_commission_int: "0",
  lock_description: true,
  lock_quantity: true,
  divisible: true,
  pool_quantity: String(XCP69_EXACT.POOL_QUANTITY),
  lp_asset: "A69000000000000069",
  status: "pending",
  earned_quantity: null,
  paid_quantity: null,
  ...over,
});

describe("the standard's own arithmetic", () => {
  it("derives 690 XCP raised and 69 minimum participants", () => {
    // If these drift, the copy on every page is lying.
    expect(XCP69_RAISE_SATS / 1e8).toBe(690);
    expect(XCP69_MIN_PARTICIPANTS).toBe(69);
  });

  it("subtracts burned tokens from circulating supply and never goes negative", () => {
    expect(circulatingSupplyRaw("10000000000000000", "100000000000000")).toBe(
      9_900_000_000_000_000n,
    );
    expect(circulatingSupplyRaw("100", "101")).toBe(0n);
  });

});

describe("xcp69Params — accepts the conforming shape", () => {
  it("passes a launch that matches the standard exactly", () => {
    expect(xcp69Params(conforming())).toBe(true);
  });

  it("passes in each of the three real statuses", () => {
    for (const status of ["pending", "open"]) {
      expect(xcp69Params(conforming({ status }))).toBe(true);
    }
    // Closed relaxes the window check, so it needs its own shape.
    expect(xcp69Params(conforming({ status: "closed" }))).toBe(true);
  });
});

describe("xcp69Params — rejects a single wrong field", () => {
  // Each case changes exactly one thing from a launch that otherwise
  // conforms, so a failure names the clause that stopped working.
  const rejects: [string, Partial<Fairminter>][] = [
    ["hard cap off by one", { hard_cap: "10000000000000001" }],
    ["soft cap off by one", { soft_cap: "6900000000000001" }],
    ["pool quantity off by one", { pool_quantity: "3100000000000001" }],
    ["price off by one", { price: "1000001" }],
    ["lot size off by one", { quantity_by_price: "100000000001" }],
    ["per-address cap off by one", { max_mint_per_address: "100000000000001" }],
    ["per-tx cap off by one", { max_mint_per_tx: "100000000000001" }],
    ["a premine", { premint_quantity: "1" }],
    ["a commission", { minted_asset_commission_int: "1" }],
    ["an unlocked quantity", { lock_quantity: false }],
    ["an unlocked description", { lock_description: false }],
    ["an indivisible asset", { divisible: false }],
    ["burn payment", { burn_payment: true }],
    ["a numeric asset", { asset: "A9876543210987654321" }],
    ["no scheduled start", { start_block: 0 }],
    ["an end block", { end_block: START + 5000 }],
    ["a window one block short", { soft_cap_deadline_block: START + XCP69.DEADLINE_BLOCKS - 1 }],
    ["a window one block long", { soft_cap_deadline_block: START + XCP69.DEADLINE_BLOCKS + 1 }],
    ["an unknown status", { status: "invalid" }],
    ["a null pool quantity", { pool_quantity: null }],
    ["a null per-address cap", { max_mint_per_address: null }],
  ];

  for (const [name, over] of rejects) {
    it(`rejects ${name}`, () => {
      expect(xcp69Params(conforming(over))).toBe(false);
    });
  }

  it("rejects a commission even when the field arrives as null-ish zero", () => {
    // null coalesces to 0 and passes; an actual value must not.
    expect(xcp69Params(conforming({ minted_asset_commission_int: null }))).toBe(true);
    expect(xcp69Params(conforming({ minted_asset_commission_int: "500000000" }))).toBe(false);
  });
});

describe("the closed-window relaxation", () => {
  it("accepts a pulled-forward deadline once closed, and only once closed", () => {
    // Core rewrites soft_cap_deadline_block to the sell-out block when a
    // launch hard-caps, so a graduated launch legitimately reads short.
    const soldOutEarly = { soft_cap_deadline_block: START + 400 };
    expect(xcp69Params(conforming({ ...soldOutEarly, status: "closed" }))).toBe(true);
    expect(xcp69Params(conforming({ ...soldOutEarly, status: "open" }))).toBe(false);
  });

  it("still rejects a closed launch whose window was too LONG", () => {
    // The relaxation is one-directional: <=, never >=.
    expect(
      xcp69Params(
        conforming({ status: "closed", soft_cap_deadline_block: START + XCP69.DEADLINE_BLOCKS + 1 }),
      ),
    ).toBe(false);
  });

  it("windowIsExact restores exact equality from the creation event", () => {
    const fm = conforming({ status: "closed", soft_cap_deadline_block: START + 400 });
    expect(windowIsExact(fm, START + XCP69.DEADLINE_BLOCKS)).toBe(true);
    // A launch actually composed with a short window is caught here — the
    // loophole the relaxation would otherwise leave open.
    expect(windowIsExact(fm, START + 400)).toBe(false);
    expect(windowIsExact(fm, null)).toBe(false);
  });
});

describe("announcedBeforeStart — the pre-announcement clause", () => {
  it("requires a pending launch to open strictly after its announcement", () => {
    expect(announcedBeforeStart(conforming({ block_index: START - 1 }))).toBe(true);
    // Confirming AT start_block opens the mint instantly — not announced.
    expect(announcedBeforeStart(conforming({ block_index: START }))).toBe(false);
    expect(announcedBeforeStart(conforming({ block_index: START + 1 }))).toBe(false);
  });

  it("passes unconfirmed rows, which cannot have opened before confirming", () => {
    expect(announcedBeforeStart(conforming({ confirmed: false, block_index: START + 5 }))).toBe(true);
    // The mempool sentinel is a sentinel, not a height.
    expect(announcedBeforeStart(conforming({ block_index: 9_999_999 }))).toBe(true);
  });

  it("judges an opened launch on the creation event, not the rewritten row", () => {
    // Once open, block_index IS start_block — judging on it would fail every
    // correctly scheduled launch the moment it opened.
    const opened = conforming({ status: "open", block_index: START });
    expect(announcedBeforeStart(opened, START - 36)).toBe(true);
    expect(announcedBeforeStart(opened, START)).toBe(false);
  });

  it("answers no, not maybe, when the event is missing", () => {
    const opened = conforming({ status: "open", block_index: START });
    expect(announcedBeforeStart(opened)).toBe(false);
    expect(announcedBeforeStart(opened, null)).toBe(false);
  });
});

describe("isXcp69 — params and timing together", () => {
  it("requires both", () => {
    expect(isXcp69(conforming())).toBe(true);
    // Right timing, wrong params.
    expect(isXcp69(conforming({ premint_quantity: "1" }))).toBe(false);
    // Right params, wrong timing.
    expect(isXcp69(conforming({ block_index: START }))).toBe(false);
  });
});

describe("launchPhase — success and failure both end at 'closed'", () => {
  it("reads scheduled and minting from status alone", () => {
    expect(launchPhase(conforming({ status: "pending" }), false)).toBe("scheduled");
    expect(launchPhase(conforming({ status: "open" }), false)).toBe("minting");
  });

  it("uses the pool as the graduated-vs-refunded oracle", () => {
    // The distinction consensus does not record in `status`.
    const closed = conforming({ status: "closed" });
    expect(launchPhase(closed, true)).toBe("graduated");
    expect(launchPhase(closed, false)).toBe("refunded");
  });

  it("treats a minted-out classic close as a success, not a refund", () => {
    // Non-pool fairminters (relaxed mode) succeed by meeting their soft cap.
    const classic = conforming({
      status: "closed",
      pool_quantity: "0",
      soft_cap: "1000",
      earned_quantity: "1000",
    });
    expect(launchPhase(classic, false)).toBe("graduated");
    expect(launchPhase({ ...classic, earned_quantity: "999" }, false)).toBe("refunded");
  });
});

describe("saleProgress / saleTarget", () => {
  it("measures against the soft cap, which is what all-or-nothing means", () => {
    expect(saleTarget(conforming())).toBe(String(XCP69_EXACT.SOFT_CAP));
    const half = conforming({ earned_quantity: "3450000000000000" });
    expect(saleProgress(half)).toBeCloseTo(0.5, 12);
  });

  it("is zero — not NaN — before the first mint", () => {
    // earned_quantity is null until someone mints; the old xcp.fun rendered
    // NaN from exactly this.
    expect(saleProgress(conforming({ earned_quantity: null }))).toBe(0);
  });

  it("falls back to the hard cap when there is no soft cap", () => {
    expect(saleTarget(conforming({ soft_cap: "0" }))).toBe(String(XCP69_EXACT.HARD_CAP));
  });
});

describe("remainingLotsForAddress", () => {
  const CAP = Number(XCP69_EXACT.MAX_MINT_PER_ADDRESS / XCP69_EXACT.QUANTITY_BY_PRICE);

  it("offers the whole allowance to an address that has not minted", () => {
    expect(remainingLotsForAddress(0n)).toBe(CAP);
  });

  it("subtracts what has already been committed", () => {
    // Half the cap taken leaves half of it available.
    expect(remainingLotsForAddress(XCP69_EXACT.MAX_MINT_PER_ADDRESS / 2n)).toBe(CAP / 2);
  });

  it("offers nothing once the cap is reached", () => {
    // The case this exists for. Under this standard max_mint_per_tx equals
    // max_mint_per_address, so a second full mint looks identical to a legal
    // first one and core only rejects it at confirmation -- after the fee.
    expect(remainingLotsForAddress(XCP69_EXACT.MAX_MINT_PER_ADDRESS)).toBe(0);
  });

  it("clamps rather than going negative past the cap", () => {
    // Reachable: two mints can sit in the mempool together, each valid
    // against a ledger that has seen neither, summing to twice the cap. A
    // negative here would become a negative lot count and a nonsense quote.
    expect(remainingLotsForAddress(XCP69_EXACT.MAX_MINT_PER_ADDRESS * 2n)).toBe(0);
  });

  it("never offers a partial lot", () => {
    // Mints are whole 1,000-token lots; core rejects a quantity that is not a
    // multiple of quantity_by_price, so rounding up here would compose a
    // transaction guaranteed to fail.
    const oneLot = XCP69_EXACT.QUANTITY_BY_PRICE;
    expect(remainingLotsForAddress(XCP69_EXACT.MAX_MINT_PER_ADDRESS - oneLot - 1n)).toBe(1);
  });
});
