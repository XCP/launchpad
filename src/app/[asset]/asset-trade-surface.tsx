"use client";

import { useState } from "react";
import { LiquidityWidget } from "@/app/swap/liquidity-widget";
import { SwapWidget } from "@/app/swap/swap-widget";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { TradePanel } from "./trade-panel";

/**
 * The /swap surface, scoped to one graduated asset: Swap | Liquidity in
 * the same grammar as the swap page, plus the DEX-native Limit tab that
 * only makes sense per-pair.
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
      <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
        <SegmentedList className="mb-4 w-full max-w-md">
          {(["swap", "liquidity", "limit"] as const).map((m) => (
            <SegmentedTrigger key={m} value={m}>
              {m}
            </SegmentedTrigger>
          ))}
        </SegmentedList>
      </Tabs>
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
