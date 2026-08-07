"use client";

import { useState } from "react";
import { LiquidityWidget } from "@/app/swap/liquidity-widget";
import {
  LiquiditySettingsGear,
  SwapSettingsGear,
  SwapSettingsProvider,
} from "@/app/swap/swap-settings";
import { SwapWidget } from "@/app/swap/swap-widget";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { TradePanel } from "./trade-panel";

/**
 * The /swap surface, scoped to one graduated asset: Swap | Liquidity in
 * the same grammar as the swap page, plus the DEX-native Limit tab that
 * only makes sense per-pair. Settings gear beside the tabs, Swap only.
 */
export function AssetTradeSurface({
  asset,
  xcpUsd,
}: {
  asset: string;
  xcpUsd: number | null;
}) {
  const [mode, setMode] = useState<"swap" | "limit" | "liquidity">("swap");
  return (
    <SwapSettingsProvider>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SegmentedList className="w-full max-w-md">
            {(["swap", "limit", "liquidity"] as const).map((m) => (
              <SegmentedTrigger key={m} value={m}>
                {m}
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Tabs>
        {mode === "swap" ? (
          <SwapSettingsGear />
        ) : mode === "liquidity" ? (
          <LiquiditySettingsGear />
        ) : null}
      </div>
      {mode === "swap" ? (
        <SwapWidget assets={[asset]} xcpUsd={xcpUsd} compact />
      ) : mode === "liquidity" ? (
        <LiquidityWidget assets={[asset]} xcpUsd={xcpUsd} />
      ) : (
        <TradePanel asset={asset} xcpUsd={xcpUsd} />
      )}
    </SwapSettingsProvider>
  );
}
