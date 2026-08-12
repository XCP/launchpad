"use client";

import { useState } from "react";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { LiquidityWidget } from "@/app/swap/_components/liquidity-widget";
import {
  LiquiditySettingsGear,
  SwapSettingsGear,
  SwapSettingsProvider,
} from "@/app/swap/_components/swap-settings";
import { SwapWidget } from "@/app/swap/_components/swap-widget";

/** Swap | Liquidity — two verbs on one pool, each mode with its own gear
 *  beside the tabs. Limit lives on its own page. */
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
