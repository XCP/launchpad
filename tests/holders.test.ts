import { describe, expect, it } from "vitest";
import {
  BURNED_ROW,
  withBurnedRow,
  coalesceHolderBalances,
  currentHolderCount,
  includeFormerHolders,
} from "@/lib/holders";

describe("holder balances", () => {
  it("combines burns and destructions without counting the burn balance twice", () => {
    const rows = withBurnedRow([{address:"alice",quantity:70n},{address:"burn",quantity:10n}], "burn", "30");
    expect(rows).toEqual([{address:"alice",quantity:70n},{address:BURNED_ROW,quantity:30n}]);
    expect(currentHolderCount(rows)).toBe(1);
    expect(rows.reduce((sum,row)=>sum+row.quantity,0n)).toBe(100n);
  });
  it("shows destruction-only totals even without a burn-address balance", () => {
    expect(withBurnedRow([], "burn", "123456789012345678")).toEqual([{address:BURNED_ROW,quantity:123456789012345678n}]);
  });
  it("hides zero burns and does not mistake a reserved burn-address balance for a burn", () => {
    expect(withBurnedRow([{address:"burn",quantity:10n}], "burn", "0")).toEqual([]);
  });
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

  it("does not count an explicitly excluded burn address", () => {
    const rows = [
      { address: "alice", quantity: 50n },
      { address: "burn", quantity: 25n },
    ];
    expect(currentHolderCount(rows, ["burn"])).toBe(1);
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
