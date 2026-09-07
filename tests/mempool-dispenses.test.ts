import { describe, expect, it } from "vitest";
import { hasPendingDispense, remainingAfterPending } from "@launchpad/xcp69/dispenser-price";

/**
 * The dispense page's one genuinely live rule, and the shape it now travels in.
 *
 * A dispenser with an unconfirmed fill is hidden from routing: a second buyer
 * racing that transaction can forfeit BTC if the escrow empties first. That
 * rule cannot come from D1, which the indexer refreshes every five minutes, so
 * it stays a mempool read.
 *
 * What changed is who asks. It used to be one request per open tab every ten
 * seconds, from the browser straight to a public Counterparty node — the same
 * pattern the header chip's poll was consolidated out of, left in place here.
 * It now rides the sitewide /v2/mempool snapshot, edge-cached for 15 seconds.
 *
 * These tests pin the rule itself, and pin the quantity shapes the API is now
 * allowed to hand it. The API stopped requiring `typeof === "number"` because
 * a raw-unit quantity can exceed 2^53 and arrive as a string; the matcher has
 * always parsed through big(), so widening the transport must not widen what
 * counts as pending.
 */

const dispenser = {
  tx_hash: "abc",
  give_quantity: 100_000_000,
  give_remaining: 300_000_000,
  satoshirate: 50_000,
};

describe("hiding a dispenser with an unconfirmed fill", () => {
  it("hides it, even though confirmed escrow has vends left behind the fill", () => {
    // Three vends of escrow, one pending. Valuation would still price this
    // dispenser; routing refuses it anyway. That asymmetry is the safety rule.
    expect(
      hasPendingDispense(dispenser, [
        { dispenser_tx_hash: "abc", dispense_quantity: 100_000_000 },
      ]),
    ).toBe(true);
    expect(
      remainingAfterPending(dispenser, [
        { dispenser_tx_hash: "abc", dispense_quantity: 100_000_000 },
      ]),
    ).toBe(200_000_000n);
  });

  it("does not hide a dispenser because some other one is busy", () => {
    // Pending activity is matched per dispenser, never by address: one address
    // can own several, each with independent escrow and pricing.
    expect(
      hasPendingDispense(dispenser, [
        { dispenser_tx_hash: "different", dispense_quantity: 100_000_000 },
      ]),
    ).toBe(false);
  });

  it("shows every dispenser when the mempool is empty", () => {
    expect(hasPendingDispense(dispenser, [])).toBe(false);
  });

  it("counts a quantity that arrived as a string", () => {
    // The API filter admits these now. If the matcher ever stopped parsing
    // them, a pending fill would silently stop hiding its dispenser — the
    // exact failure the rule exists to prevent, and an invisible one.
    expect(
      hasPendingDispense(dispenser, [
        { dispenser_tx_hash: "abc", dispense_quantity: "100000000" },
      ]),
    ).toBe(true);
  });

  it("ignores a zero-quantity event rather than hiding on it", () => {
    // A malformed or invalid event is not a reason to withdraw a live route.
    expect(
      hasPendingDispense(dispenser, [{ dispenser_tx_hash: "abc", dispense_quantity: 0 }]),
    ).toBe(false);
  });

  it("ignores an event with no dispenser to match", () => {
    expect(
      hasPendingDispense(dispenser, [
        { dispenser_tx_hash: null, dispense_quantity: 100_000_000 },
      ]),
    ).toBe(false);
  });

  it("hides on any one of several pending fills", () => {
    expect(
      hasPendingDispense(dispenser, [
        { dispenser_tx_hash: "other", dispense_quantity: 100_000_000 },
        { dispenser_tx_hash: "abc", dispense_quantity: 100_000_000 },
      ]),
    ).toBe(true);
  });
});
