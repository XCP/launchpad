"use client";

import { useState } from "react";
import { LiquidityWidget } from "./liquidity-widget";
import { SwapWidget } from "./swap-widget";

/** Swap | Liquidity, side by side — one surface for the whole pool. */
export function TradeSurface({
  assets,
  xcpUsd,
}: {
  assets: string[];
  xcpUsd: number | null;
}) {
  const [mode, setMode] = useState<"swap" | "liquidity">("swap");
  return (
    <div>
      <div className="mb-4 flex w-64 items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
        {(["swap", "liquidity"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md px-4 py-2 capitalize ${
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
        <SwapWidget assets={assets} xcpUsd={xcpUsd} />
      ) : (
        <LiquidityWidget assets={assets} xcpUsd={xcpUsd} />
      )}
    </div>
  );
}
