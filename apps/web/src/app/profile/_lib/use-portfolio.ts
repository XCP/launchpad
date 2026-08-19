"use client";

import useSWR from "swr";
import {
  fetchAssetBalance,
  fetchBlockHeight,
  fetchBlockTime,
  fetchPoolPriceHistory,
  type PoolSnapshot,
} from "@/lib/api/counterparty";
import { fetchEventsBySource, fetchMintsBySource, fetchSearchIndex } from "@/lib/api/launchpad-api";
import { fetchXcpUsd } from "@/lib/api/price";
import { big } from "@/lib/numeric";
import type { BalanceDelta, PriceSnapshot } from "@/lib/portfolio-chart";
import { computePositions, type ClosedPosition, type PairedDelta, type Position, type PositionInput } from "@/lib/positions";

export interface Portfolio {
  open: Position[];
  closed: ClosedPosition[];
  divisible: Map<string, boolean>;
  xcpUsd: number | null;
  /** Everything that moved a token balance, for the value chart. */
  deltas: BalanceDelta[];
  /** Pool reserves over time, per asset. */
  prices: Map<string, PriceSnapshot[]>;
  tipBlock: number;
  /** Real Unix seconds for the tip — the newest time anchor. */
  tipTime: number | null;
}

/** Positions and closed positions come out of one pass over the ledger, so
 *  both tabs share a cache key and the work happens once. */
export function usePortfolio(address: string) {
  const { data, isLoading } = useSWR(
    ["portfolio", address],
    async () => {
      // Five focused requests. This used to also paginate the address's whole
      // credit/debit ledger — ~14,000 rows across 17 requests — to pair XCP
      // legs with token legs. apps/api does that pairing now, so the same
      // answer costs one indexed read.
      const [launches, xcpUsd, mints, events, tipBlock] = await Promise.all([
        fetchSearchIndex(),
        fetchXcpUsd(),
        fetchMintsBySource(address),
        fetchEventsBySource(address),
        fetchBlockHeight(),
      ]);
      const tipTime = await fetchBlockTime(tipBlock);
      // Only graduated launches have a pool, and only a pool gives a price.
      const graduated = (launches ?? []).filter(
        (l) => l.phase === "graduated" && l.pool_xcp_reserve && l.pool_token_reserve,
      );
      const universe: PositionInput[] = graduated.map((l) => ({
        asset: l.asset,
        poolXcpReserve: l.pool_xcp_reserve!,
        poolTokenReserve: l.pool_token_reserve!,
      }));
      // Conformance requires divisible=true; the compact all-launch index can
      // omit a column whose answer is constant for this universe.
      const divisible = new Map(graduated.map((l) => [l.asset, true]));

      // Both ways a balance moves, both legs already paired. A mint only
      // yields tokens once its launch closes successfully: while it is still
      // minting the XCP is escrowed and nothing has been credited, and a
      // refunded launch hands the XCP back and credits nothing ever.
      const paired: PairedDelta[] = [
        ...(mints ?? [])
          .filter((m) => m.phase === "graduated")
          .map((m) => ({
            asset: m.asset,
            block: m.block,
            tokenDelta: big(m.earned),
            xcpDelta: -big(m.paid),
          })),
        ...(events ?? []).map((e) => ({
          asset: e.asset,
          block: e.block,
          tokenDelta: big(e.tokenDelta),
          xcpDelta: big(e.xcpDelta),
        })),
      ];
      const deltas: BalanceDelta[] = paired.map((d) => ({
        asset: d.asset,
        block: d.block,
        tokenDelta: d.tokenDelta,
      }));

      // Live balances for the graduated universe only. Paging every balance
      // this address holds was 1,766 rows to answer a question about at most a
      // handful of assets.
      const balances = new Map<string, string>();
      await Promise.all(
        universe.map(async (u) => {
          balances.set(u.asset, await fetchAssetBalance(address, u.asset));
        }),
      );

      // Price history only for assets actually held — the chart can't show
      // what isn't in the portfolio, so fetching the rest would be waste.
      const held = new Set(deltas.map((d) => d.asset));
      const prices = new Map<string, PriceSnapshot[]>();
      await Promise.all(
        graduated
          .filter((l) => held.has(l.asset))
          .map(async (l) => {
            const xcpIsA = (s: PoolSnapshot) => s.asset_a === "XCP";
            const snaps = await fetchPoolPriceHistory(l.asset);
            prices.set(
              l.asset,
              snaps
                .map((s) => ({
                  block: s.block_index,
                  time: s.block_time,
                  xcpReserve: big(xcpIsA(s) ? s.reserve_a : s.reserve_b),
                  tokenReserve: big(xcpIsA(s) ? s.reserve_b : s.reserve_a),
                }))
                .sort((a, b) => a.block - b.block),
            );
          }),
      );

      return {
        ...computePositions(paired, universe, balances),
        divisible,
        xcpUsd,
        deltas,
        prices,
        tipBlock,
        tipTime,
      };
    },
    // Block-paced: none of this can change between blocks, and blocks land
    // about every ten minutes. Polling faster only repeats work.
    { refreshInterval: 600_000, revalidateOnFocus: false },
  );

  return { portfolio: data, isLoading };
}
