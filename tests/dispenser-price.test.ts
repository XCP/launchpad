import { describe, expect, it } from "vitest";
import {
  bestAskSats,
  remainingAfterPending,
} from "@launchpad/xcp69/dispenser-price";

const ask = (tx_hash: string, sats: number, remainingXcp: number) => ({
  tx_hash,
  give_quantity: 100_000_000,
  give_remaining: remainingXcp * 100_000_000,
  satoshirate: sats,
});

describe("mempool-adjusted dispenser price", () => {
  it("skips a cheapest dispenser whose final vend is already pending", () => {
    const rows = [ask("cheap", 3_650, 1), ask("next", 4_200, 4)];
    const pending = [
      { dispenser_tx_hash: "cheap", dispense_quantity: 100_000_000 },
    ];

    expect(bestAskSats(rows, pending)).toBe(4_200);
  });

  it("keeps a partially consumed dispenser at its remaining depth", () => {
    const row = ask("deep", 3_650, 3);
    const pending = [
      { dispenser_tx_hash: "deep", dispense_quantity: 100_000_000 },
    ];

    expect(remainingAfterPending(row, pending)).toBe(200_000_000n);
    expect(bestAskSats([row, ask("next", 4_200, 4)], pending)).toBe(3_650);
  });

  it("aggregates several pending fills against the exact dispenser", () => {
    const row = ask("same", 3_650, 2);
    const pending = [
      { dispenser_tx_hash: "other", dispense_quantity: 100_000_000 },
      { dispenser_tx_hash: "same", dispense_quantity: 100_000_000 },
      { dispenser_tx_hash: "same", dispense_quantity: 100_000_000 },
    ];

    expect(remainingAfterPending(row, pending)).toBe(0n);
  });
});
