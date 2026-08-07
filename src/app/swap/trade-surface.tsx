"use client";

import { useState } from "react";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { LiquidityWidget } from "./liquidity-widget";
import {
  LiquiditySettingsGear,
  SwapSettingsGear,
  SwapSettingsProvider,
} from "./swap-settings";
import { SwapWidget } from "./swap-widget";

/** Swap | Liquidity, side by side — one surface for the whole pool.
 *  The settings gear sits to the right of the tabs (shown on the Swap
 *  tab only, the Uniswap placement). */
export function TradeSurface({
  assets,
  xcpUsd,
}: {
  assets: string[];
  xcpUsd: number | null;
}) {
  const [mode, setMode] = useState<"swap" | "liquidity">("swap");
  return (
    <SwapSettingsProvider>
      <div className="mb-4 flex items-center justify-between">
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SegmentedList className="w-64">
            {(["swap", "liquidity"] as const).map((m) => (
              <SegmentedTrigger key={m} value={m}>
                {m}
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Tabs>
        {mode === "swap" ? <SwapSettingsGear /> : <LiquiditySettingsGear />}
      </div>
      {mode === "swap" ? (
        <SwapWidget assets={assets} xcpUsd={xcpUsd} />
      ) : (
        <LiquidityWidget assets={assets} xcpUsd={xcpUsd} />
      )}
    </SwapSettingsProvider>
  );
}
