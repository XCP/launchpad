/**
 * Fabricated profile data for the preview pill — the same device
 * phase-preview.tsx uses on asset pages, for the same reason: nothing has
 * graduated yet, so every one of these tabs is empty and its design can't be
 * looked at.
 *
 * The numbers are the standard's own: a graduated XCP-69 pool holds
 * POOL_QUANTITY tokens against the 690 XCP raise, and a max mint buys
 * 1,000,000 tokens for 10 XCP. That makes the opening price ~2.2x the mint
 * price, which is a real property of the standard rather than a flattering
 * invention — a demo that shows impossible numbers teaches the wrong thing.
 */
import type { ActivityRow } from "@/lib/activity";
import type { PriceSnapshot } from "@/lib/portfolio-chart";
import type { Portfolio } from "@/app/profile/_lib/use-portfolio";

/** 690 XCP against 31,000,000 tokens — a pool at the moment it opens. */
const POOL_XCP = 69_000_000_000n;
const POOL_TOKENS = 3_100_000_000_000_000n;
/** A max mint: 1,000,000 tokens for 10 XCP. */
const MINT_TOKENS = 100_000_000_000_000n;
const MINT_COST = 1_000_000_000n;

/** value = balance * poolXcp / poolTokens, exact in raw units. */
const valueOf = (balance: bigint, poolXcp = POOL_XCP, poolTokens = POOL_TOKENS) =>
  (balance * poolXcp) / poolTokens;

/**
 * A plausible price path for the preview: the pool's XCP reserve drifting over
 * a month. Deterministic — a chart that reshuffles on every render is a chart
 * nobody can point at and discuss.
 */
const DEMO_NOW = 1_786_400_000;

function demoPrices(tip: number): Map<string, PriceSnapshot[]> {
  const start = tip - 4320; // 30 days of blocks
  const make = (openMultiple: number, drift: number) => {
    const snaps: PriceSnapshot[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      // The shape is a float; the money is not. Scaling in basis points keeps
      // the reserve an exact integer instead of routing it through a double.
      const bps = Math.round(10_000 * openMultiple * (1 + drift * t) * (1 + 0.06 * Math.sin(i * 0.7)));
      const block = Math.round(start + t * 4320);
      snaps.push({
        block,
        // Ten minutes a block is fine HERE: this is fabricated data, not a
        // real chain being measured.
        time: DEMO_NOW - (tip - block) * 600,
        xcpReserve: (POOL_XCP * BigInt(bps)) / 10_000n,
        tokenReserve: POOL_TOKENS,
      });
    }
    return snaps;
  };
  return new Map([
    ["LOOSH", make(1, 0.9)],
    ["GATO", make(1, -0.45)],
    ["HOPIUM", make(1, 0.2)],
  ]);
}

export function demoPortfolio(tip = 962_000): Portfolio {
  // Minted at 10 XCP, now marked at the opening pool price: up ~122%.
  const looshValue = valueOf(MINT_TOKENS);
  // Bought 500k tokens for 25 XCP into a pool that has since thinned.
  const gatoBalance = 50_000_000_000_000n;
  const gatoValue = valueOf(gatoBalance, 41_000_000_000n, POOL_TOKENS);
  const gatoCost = 2_500_000_000n;
  // Arrived as a transfer, so there is no cost in the ledger to reason from.
  const hopiumBalance = 20_000_000_000_000n;

  return {
    open: [
      {
        asset: "LOOSH",
        balance: MINT_TOKENS,
        costXcpSats: MINT_COST,
        valueXcpSats: looshValue,
        unrealizedXcpSats: looshValue - MINT_COST,
        realizedXcpSats: 0n,
      },
      {
        asset: "GATO",
        balance: gatoBalance,
        costXcpSats: gatoCost,
        valueXcpSats: gatoValue,
        unrealizedXcpSats: gatoValue - gatoCost,
        realizedXcpSats: 30_000_000n,
      },
      {
        asset: "HOPIUM",
        balance: hopiumBalance,
        costXcpSats: null,
        valueXcpSats: valueOf(hopiumBalance),
        unrealizedXcpSats: null,
        realizedXcpSats: 0n,
        withheld: "received tokens with no recorded price",
      },
    ],
    closed: [
      { asset: "PEPECASK", realizedXcpSats: 1_250_000_000n },
      { asset: "TENX", realizedXcpSats: -300_000_000n },
    ],
    divisible: new Map([
      ["LOOSH", true],
      ["GATO", true],
      ["HOPIUM", true],
      ["PEPECASK", true],
      ["TENX", true],
    ]),
    xcpUsd: 1.85,
    deltas: [
      { asset: "LOOSH", block: tip - 4200, tokenDelta: MINT_TOKENS },
      { asset: "GATO", block: tip - 3000, tokenDelta: gatoBalance + 10_000_000_000_000n },
      { asset: "GATO", block: tip - 900, tokenDelta: -10_000_000_000_000n },
      { asset: "HOPIUM", block: tip - 600, tokenDelta: hopiumBalance },
    ],
    prices: demoPrices(tip),
    tipBlock: tip,
    tipTime: DEMO_NOW,
  };
}

/** One row of every kind, newest first. */
export function demoActivity(height: number): { rows: ActivityRow[]; height: number } {
  const row = (
    key: string,
    blocksAgo: number,
    kind: ActivityRow["kind"],
    asset: string,
    tokenDelta: bigint,
    xcpDelta: bigint,
  ): ActivityRow => ({
    key,
    block: height - blocksAgo,
    kind,
    asset,
    tokenDelta,
    xcpDelta,
    divisible: true,
  });

  return {
    height,
    rows: [
      row("d1", 6, "mint_pending", "STARMONEY", MINT_TOKENS, -MINT_COST),
      row("d2", 40, "buy", "LOOSH", 25_000_000_000_000n, -800_000_000n),
      row("d3", 90, "sell", "GATO", -10_000_000_000_000n, 450_000_000n),
      row("d4", 150, "mint", "LOOSH", MINT_TOKENS, -MINT_COST),
      row("d6", 620, "sell", "PEPECASK", -5_000_000_000_000n, 210_000_000n),
      row("d7", 900, "refund", "GENTLEGIANT", 0n, MINT_COST),
    ],
  };
}
