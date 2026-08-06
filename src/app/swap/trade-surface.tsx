"use client";

import { useState } from "react";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
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
      <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
        <SegmentedList className="mb-4 w-64">
          {(["swap", "liquidity"] as const).map((m) => (
            <SegmentedTrigger key={m} value={m}>
              {m}
            </SegmentedTrigger>
          ))}
        </SegmentedList>
      </Tabs>
      {mode === "swap" ? (
        <SwapWidget assets={assets} xcpUsd={xcpUsd} />
      ) : (
        <LiquidityWidget assets={assets} xcpUsd={xcpUsd} />
      )}
    </div>
  );
}
