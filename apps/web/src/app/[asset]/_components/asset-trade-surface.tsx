"use client";

import { useState } from "react";
import { LiquidityWidget } from "@/app/swap/_components/liquidity-widget";
import {
  LimitSettingsGear,
  LiquiditySettingsGear,
  SwapSettingsGear,
  SwapSettingsProvider,
} from "@/app/swap/_components/swap-settings";
import { SwapWidget } from "@/app/swap/_components/swap-widget";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { TradePanel } from "@/app/[asset]/_components/trade-panel";

/**
 * The /swap surface, scoped to one graduated asset: Swap | Liquidity in
 * the same grammar as the swap page, plus the DEX-native Limit tab that
 * only makes sense per-pair. Settings gear beside the tabs, Swap only.
 */
export function AssetTradeSurface({
  asset,
  xcpUsd,
  aside,
}: {
  asset: string;
  xcpUsd: number | null;
  /** Rendered beside the form, starting level with it rather than with the
   *  tab row above — same two-row shape the dispense page uses. */
  aside?: React.ReactNode;
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
        ) : mode === "limit" ? (
          <LimitSettingsGear />
        ) : (
          <LiquiditySettingsGear />
        )}
      </div>
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-start sm:gap-6">
        <div className="min-w-0">
          {mode === "swap" ? (
            <SwapWidget assets={[asset]} xcpUsd={xcpUsd} compact />
          ) : mode === "liquidity" ? (
            <LiquidityWidget assets={[asset]} xcpUsd={xcpUsd} />
          ) : (
            <TradePanel asset={asset} xcpUsd={xcpUsd} />
          )}
        </div>
        {aside}
      </div>
    </SwapSettingsProvider>
  );
}
