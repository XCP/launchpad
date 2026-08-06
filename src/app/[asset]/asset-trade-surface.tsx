"use client";

import { useState } from "react";
import { LiquidityWidget } from "@/app/swap/liquidity-widget";
import { SwapWidget } from "@/app/swap/swap-widget";
import { TradePanel } from "./trade-panel";

/**
 * The /swap surface, scoped to one graduated asset: Swap | Liquidity in
 * the same grammar as the swap page, plus the DEX-native tabs (Limit,
 * Orders) that only make sense per-pair.
 */
export function AssetTradeSurface({
  asset,
  xcpUsd,
}: {
  asset: string;
  xcpUsd: number | null;
}) {
  const [mode, setMode] = useState<"swap" | "liquidity" | "limit">("swap");
  return (
    <div>
      <div className="mb-4 flex w-full max-w-md items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
        {(["swap", "liquidity", "limit"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md px-3 py-2 capitalize ${
              mode === m
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === "swap" ? (
        <SwapWidget assets={[asset]} xcpUsd={xcpUsd} />
      ) : mode === "liquidity" ? (
        <LiquidityWidget assets={[asset]} xcpUsd={xcpUsd} />
      ) : (
        <TradePanel asset={asset} only="limit" />
      )}
    </div>
  );
}
