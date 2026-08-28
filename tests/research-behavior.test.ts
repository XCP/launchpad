import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MempoolOrder } from "@launchpad/xcp69/mempool";
import { pendingPressureByAsset } from "@/app/research/_lib/behavior";
import { LaunchTable, SellerSummary } from "@/app/research/_components/live-behavior-dashboard";
import {
  fetchResearchBehavior,
  type ResearchBehaviorSnapshot,
  type ResearchLaunchBehavior,
} from "@/lib/api/launchpad-api";

const order = (over: Partial<MempoolOrder> = {}): MempoolOrder => ({
  txHash: "tx",
  source: "1SELLER",
  asset: "FUNTRUMP",
  giveAsset: "FUNTRUMP",
  getAsset: "XCP",
  giveQuantity: "100000000000000",
  getQuantity: "100000000",
  ...over,
});

const behavior = (over: Partial<ResearchLaunchBehavior["behavior"]> = {}): ResearchLaunchBehavior["behavior"] => ({
  trackedMinters: 69,
  holdingSignal: 20,
  minterTraders: 4,
  immediateDumpers: 30,
  laterDumpers: 19,
  dumpersExited: 25,
  dumpersRemaining: 24,
  dumperOverhang: "1200000000000000",
  fastDumpersExited: 18,
  fastDumpersRemaining: 12,
  fastDumperOverhang: "600000000000000",
  knownFastMinters: 30,
  knownFastInventory: "3000000000000000",
  repeatDumpMinters: 10,
  repeatDumpInventory: "1000000000000000",
  heldWithoutSale: 20,
  movedWithoutSale: 10,
  sellersHolding: 12,
  sellerBalance: "1200000000000000",
  dumpersHolding: 6,
  dumperBalance: "600000000000000",
  dispenserSellers: 1,
  buyers: 12,
  buyerOnly: 7,
  boughtXcp: "5000000000",
  soldXcp: "6000000000",
  ...over,
});

const row = (over: Partial<ResearchLaunchBehavior> = {}): ResearchLaunchBehavior => ({
  asset: "FUNTRUMP",
  phase: "graduated",
  minters: 69,
  earnedQuantity: "6900000000000000",
  softCap: "6900000000000000",
  hardCap: "10000000000000000",
  poolXcpReserve: "69000000000",
  poolTokenReserve: "3100000000000000",
  behavior: behavior(),
  ...over,
});

describe("research mempool pressure", () => {
  it("counts transactions and distinct wallets separately", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      order({ txHash: `sell-${i}`, source: i < 12 ? "1A" : "1B" }),
    );
    expect(pendingPressureByAsset(rows).get("FUNTRUMP")).toEqual({
      sellTransactions: 20,
      sellWallets: 2,
      sellQuantity: 2_000_000_000_000_000n,
      buyTransactions: 0,
      buyWallets: 0,
    });
  });

  it("separates buys from sells and ignores non-XCP pairs", () => {
    const pressure = pendingPressureByAsset([
      order(),
      order({
        txHash: "buy",
        source: "1BUYER",
        giveAsset: "XCP",
        getAsset: "FUNTRUMP",
        giveQuantity: "200000000",
        getQuantity: "100000000000000",
      }),
      order({ txHash: "other", giveAsset: "FUNTRUMP", getAsset: "BTC" }),
    ]).get("FUNTRUMP");
    expect(pressure?.sellTransactions).toBe(1);
    expect(pressure?.buyTransactions).toBe(1);
    expect(pressure?.buyWallets).toBe(1);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("research API mapping", () => {
  it("maps the seller matrix, balances, and dump fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({
          result: [{
            asset: "FUNTRUMP",
            phase: "graduated",
            minters: 69,
            earned_quantity: "6900000000000000",
            soft_cap: "6900000000000000",
            hard_cap: "10000000000000000",
            pool_xcp_reserve: "69000000000",
            pool_token_reserve: "3100000000000000",
            behavior: {
              tracked_minters: 69,
              holding_signal: 20,
              minter_traders: 4,
              immediate_dumpers: 30,
              later_dumpers: 19,
              dumpers_exited: 25,
              dumpers_remaining: 24,
              dumper_overhang: "1200000000000000",
              fast_dumpers_exited: 18,
              fast_dumpers_remaining: 12,
              fast_dumper_overhang: "600000000000000",
              known_fast_minters: 30,
              known_fast_inventory: "3000000000000000",
              repeat_dump_minters: 10,
              repeat_dump_inventory: "1000000000000000",
              held_without_sale: 20,
              moved_without_sale: 10,
              sellers_holding: 12,
              seller_balance_raw: "1200000000000000",
              fast_sellers_holding: 6,
              fast_seller_balance_raw: "600000000000000",
              dispenser_sellers: 1,
              buyers: 12,
              buyer_only: 7,
              bought_xcp: "5000000000",
              sold_xcp: "6000000000",
            },
          }],
          cohorts: {
            minter_addresses: 256,
            mint_and_holding: 136,
            mint_and_trading: 10,
            immediate_dumpers: 30,
            later_dumpers: 20,
            buyers: 50,
            graduated_minter_addresses: 229,
            graduated_never_sold: 136,
            seller_addresses: 93,
            redeploy_and_hold: 37,
            redeploy_and_exit: 35,
            hold_without_redeploy: 3,
            exit_without_redeploy: 18,
            redeployed_paid_raw: "212464000000",
            repeat_fast: [],
          },
          fast_exit_blocks: 6,
        })),
      ),
    );

    const snapshot = await fetchResearchBehavior();
    expect(snapshot?.cohorts).toMatchObject({
      sellerAddresses: 93,
      redeployAndHold: 37,
      redeployAndExit: 35,
      holdWithoutRedeploy: 3,
      exitWithoutRedeploy: 18,
      redeployedPaid: "212464000000",
    });
    expect(snapshot?.launches[0]?.behavior).toMatchObject({
      repeatDumpMinters: 10,
      heldWithoutSale: 20,
      movedWithoutSale: 10,
      sellersHolding: 12,
      sellerBalance: "1200000000000000",
      dumpersHolding: 6,
      dumperBalance: "600000000000000",
      dispenserSellers: 1,
    });
  });

  it("rejects a response that omits the authoritative threshold", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result: [], cohorts: {} }))));
    expect(await fetchResearchBehavior()).toBeNull();
  });
});

describe("research dashboard rendering", () => {
  it("makes the seller groups exclusive and explicit", () => {
    const cohorts: ResearchBehaviorSnapshot["cohorts"] = {
      minterAddresses: 256,
      mintAndHolding: 136,
      mintAndTrading: 10,
      immediateDumpers: 30,
      laterDumpers: 20,
      buyers: 50,
      graduatedMinterAddresses: 229,
      graduatedNeverSold: 136,
      sellerAddresses: 93,
      redeployAndHold: 37,
      redeployAndExit: 35,
      holdWithoutRedeploy: 3,
      exitWithoutRedeploy: 18,
      redeployedPaid: "212464000000",
      repeatFast: [],
    };
    const html = renderToStaticMarkup(React.createElement(SellerSummary, { cohorts }));
    expect(html).toContain("93 unique minter addresses made a sale");
    expect(html).toContain("72</strong> minted again");
    expect(html).toContain("Minted again");
    expect(html).toContain("Did not mint again");
    expect(html).toContain("No meaningful balance");
  });

  it("shows exclusive graduated outcomes, inventory, buyers, and the dump queue", () => {
    const html = renderToStaticMarkup(React.createElement(LaunchTable, {
      mode: "graduated",
      title: "After graduation",
      subtitle: "Ranked by market cap",
      rows: [row()],
      pending: new Map([["FUNTRUMP", {
        sellTransactions: 20,
        sellWallets: 3,
        sellQuantity: 2_000_000_000_000_000n,
        buyTransactions: 1,
        buyWallets: 1,
      }]]),
    }));
    expect(html).toContain("20 held");
    expect(html).toContain("10 moved");
    expect(html).toContain("39 sold");
    expect(html).toContain("exclusive outcomes");
    expect(html).toContain("12.0% of supply");
    expect(html).toContain("7</strong>");
    expect(html).toContain("20 pending sells · 3 wallets · 20M tokens");
  });

  it("labels active-launch history as dumpers", () => {
    const minting = row({
      asset: "STILLMINTING",
      phase: "minting",
      minters: 10,
      earnedQuantity: "1000000000000000",
      poolXcpReserve: null,
      poolTokenReserve: null,
      behavior: behavior({
        trackedMinters: 10,
        knownFastMinters: 3,
        knownFastInventory: "200000000000000",
        repeatDumpMinters: 1,
        repeatDumpInventory: "100000000000000",
      }),
    });
    const html = renderToStaticMarkup(React.createElement(LaunchTable, {
      mode: "minting",
      title: "Minting now",
      subtitle: "Ranked by progress",
      rows: [minting],
      pending: new Map(),
    }));
    expect(html).toContain(">Dumpers<");
    expect(html).toContain("Repeat dumpers");
    expect(html).toContain("20.0%");
    expect(html).toContain("10.0%");
    expect(html).not.toContain("Fast allocation");
  });
});
