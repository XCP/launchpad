import { describe, expect, it } from "vitest";
import {
  coalesceHolderBalances,
  currentHolderCount,
  includeFormerHolders,
} from "@/lib/holders";

describe("holder balances", () => {
  it("counts positive owners while retaining sold-out rows", () => {
    const rows = coalesceHolderBalances([
      { address: "alice", utxo: null, quantity: "50" },
      { address: "bob", utxo: null, quantity: "0" },
      { address: "carol", utxo: null, quantity: "25" },
    ]);

    expect(currentHolderCount(rows)).toBe(2);
    expect(rows).toEqual([
      { address: "alice", quantity: 50n },
      { address: "carol", quantity: 25n },
      { address: "bob", quantity: 0n },
    ]);
  });

  it("coalesces every balance location owned by the same address", () => {
    const rows = coalesceHolderBalances([
      { address: "alice", utxo: null, quantity: "40" },
      { address: "alice", utxo: "tx:0", quantity: "2" },
      { address: null, utxo: "tx:1", quantity: "3" },
      { address: null, utxo: "tx:2", quantity: "0" },
      { address: null, utxo: null, quantity: "999" },
    ]);

    expect(rows).toEqual([
      { address: "alice", quantity: 42n },
      { address: "utxo:tx:1", quantity: 3n },
      { address: "utxo:tx:2", quantity: 0n },
    ]);
    expect(currentHolderCount(rows)).toBe(2);
  });

  it("restores sold-out addresses without counting them as current holders", () => {
    const rows = includeFormerHolders(
      [
        { address: "alice", quantity: 50n },
        { address: "carol", quantity: 25n },
      ],
      ["bob", "alice", "bob"],
    );

    expect(rows).toEqual([
      { address: "alice", quantity: 50n },
      { address: "carol", quantity: 25n },
      { address: "bob", quantity: 0n },
    ]);
    expect(currentHolderCount(rows)).toBe(2);
  });
});
