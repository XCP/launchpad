import { describe, expect, it } from "vitest";
import { LAUNCH_TX_VBYTES, launchCostSats, launchDustSats } from "@/lib/launch-cost";

/** What PARTYKILLER's on-chain launch actually carried, which is where the
 *  constants in this module came from. */
const REAL_DESCRIPTION = "https://xcp.fun/PARTYKILLER.json"; // 32 chars
const REAL_DUST = 3_000; // three multisig outputs x 1,000 sats
const REAL_VBYTES = 534; // weight 2136

describe("launchDustSats", () => {
  it("reproduces the measurement it was derived from", () => {
    // The anchor: 132-byte payload, ceil(132/53) = 3 outputs, 3,000 sats —
    // exactly the three 1,000-sat multisig outputs on that transaction.
    expect(REAL_DESCRIPTION).toHaveLength(32);
    expect(launchDustSats(REAL_DESCRIPTION)).toBe(REAL_DUST);
    expect(LAUNCH_TX_VBYTES).toBe(REAL_VBYTES);
  });

  it("gives the same answer for every asset name the site allows", () => {
    // Names run 4-12 characters, so the description spans 25-33 — an 8-byte
    // swing that never crosses a chunk boundary. This is the assertion that
    // makes the old hardcoded 3,000 safe rather than lucky.
    for (let len = 4; len <= 12; len += 1) {
      const description = `https://xcp.fun/${"X".repeat(len)}.json`;
      expect(launchDustSats(description)).toBe(REAL_DUST);
    }
  });

  it("charges a fourth output once the payload actually needs one", () => {
    // The failure mode a constant would hide: 100 fixed + 60 description =
    // 160 bytes, one past what three 53-byte chunks hold.
    expect(launchDustSats("X".repeat(59))).toBe(3_000);
    expect(launchDustSats("X".repeat(60))).toBe(4_000);
  });

  it("never quotes zero, because a launch always carries data outputs", () => {
    expect(launchDustSats("")).toBeGreaterThan(0);
  });
});

describe("launchCostSats", () => {
  it("adds the miner fee to the dust rather than quoting either alone", () => {
    expect(launchCostSats(1, REAL_DESCRIPTION)).toBe(534 + REAL_DUST);
  });

  it("is an order of magnitude past what the old quote claimed", () => {
    // The old estimate was feeRate x 200 vbytes and nothing else: 200 sats at
    // 1 sat/vB against a real 3,534. Pinned as a ratio so the regression is
    // named rather than implied.
    const oldQuote = 1 * 200;
    expect(launchCostSats(1, REAL_DESCRIPTION) / oldQuote).toBeGreaterThan(17);
  });

  it("scales the fee with the rate and leaves the dust fixed", () => {
    // Dust is a protocol threshold, not a market price — it does not move
    // with the fee rate.
    expect(launchCostSats(10, REAL_DESCRIPTION)).toBe(5_340 + REAL_DUST);
    expect(launchCostSats(10, REAL_DESCRIPTION) - launchCostSats(1, REAL_DESCRIPTION)).toBe(
      9 * REAL_VBYTES,
    );
  });

  it("still requires the dust at a zero fee rate", () => {
    expect(launchCostSats(0, REAL_DESCRIPTION)).toBe(REAL_DUST);
  });
});
