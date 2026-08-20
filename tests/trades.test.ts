import { describe, expect, it, vi } from "vitest";
import { mergePairTrades } from "@launchpad/xcp69/trades";
import { toIndexedRows } from "#api/indexer/events";

const tx = "e7a3380dbd45ac3e7a142389ae16ce334344837143b9d2854ea28d5ee2818897";

describe("pair trade chronology", () => {
  it("uses event order for several pool and book fills in one transaction", async () => {
    const pool = [
      {
        status: "valid",
        tx_hash: tx,
        tx_index: 3170028,
        block_index: 963242,
        block_time: 1787193354,
        source: "bc1pqehcgp5z28a5f9ef9w60zrjkgw332hlf8ulta53t6s56dn086f5sy7qthe",
        forward_asset: "CAPTAINDAN",
        backward_asset: "XCP",
        forward_quantity: "273012812618887",
        backward_quantity: "10917625682",
      },
      {
        status: "valid",
        tx_hash: tx,
        tx_index: 3170028,
        block_index: 963242,
        block_time: 1787193354,
        source: "bc1pqehcgp5z28a5f9ef9w60zrjkgw332hlf8ulta53t6s56dn086f5sy7qthe",
        forward_asset: "CAPTAINDAN",
        backward_asset: "XCP",
        forward_quantity: "16107043441048",
        backward_quantity: "730187677",
      },
    ];
    const book = [
      {
        id: "order-match-id",
        tx1_hash: tx,
        tx1_index: 3170028,
        tx1_address: "bc1pqehcgp5z28a5f9ef9w60zrjkgw332hlf8ulta53t6s56dn086f5sy7qthe",
        block_index: 963242,
        block_time: 1787193354,
        forward_asset: "CAPTAINDAN",
        backward_asset: "XCP",
        forward_quantity: "10000000000000",
        backward_quantity: "450000000",
      },
    ];
    const fetchEvents = vi.fn(async () => [
      {
        event_index: 20449811,
        event: "POOL_MATCH",
        params: { ...pool[1] },
      },
      {
        event_index: 20449808,
        event: "ORDER_MATCH",
        params: { ...book[0] },
      },
      {
        event_index: 20449801,
        event: "POOL_MATCH",
        params: { ...pool[0] },
      },
    ]);

    const trades = await mergePairTrades("CAPTAINDAN", pool, book, fetchEvents);

    expect(fetchEvents).toHaveBeenCalledOnce();
    expect(trades.map((trade) => trade.eventIndex)).toEqual([
      20449811, 20449808, 20449801,
    ]);
    expect(trades.map((trade) => trade.venue)).toEqual(["pool", "book", "pool"]);
    expect(trades.map((trade) => trade.xcpQuantity)).toEqual([
      "730187677", "450000000", "10917625682",
    ]);
    expect(new Set(trades.map((trade) => trade.key)).size).toBe(3);

    const indexed = toIndexedRows("CAPTAINDAN", trades);
    expect(indexed).toHaveLength(3);
    expect(new Set(indexed.map((row) => row.id)).size).toBe(3);
    expect(indexed.map((row) => row.event)).toEqual([
      `${tx}#20449811`,
      "order-match-id",
      tx,
    ]);
  });

  it("orders ordinary same-block transactions by tx index without extra requests", async () => {
    const fetchEvents = vi.fn(async () => []);
    const trades = await mergePairTrades(
      "TOKEN",
      [
        {
          tx_hash: "older",
          tx_index: 10,
          block_index: 100,
          source: "a",
          forward_asset: "TOKEN",
          backward_asset: "XCP",
          forward_quantity: "1",
          backward_quantity: "1",
        },
        {
          tx_hash: "newer",
          tx_index: 11,
          block_index: 100,
          source: "b",
          forward_asset: "TOKEN",
          backward_asset: "XCP",
          forward_quantity: "1",
          backward_quantity: "2",
        },
      ],
      [],
      fetchEvents,
    );

    expect(trades.map((trade) => trade.txHash)).toEqual(["newer", "older"]);
    expect(fetchEvents).not.toHaveBeenCalled();
  });
});
