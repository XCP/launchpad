"use client";

import { useState } from "react";
import { TradePanel } from "@/app/[asset]/trade-panel";
import { AssetChip } from "@/components/asset-chip";
import { TokenSelectModal } from "@/components/token-select-modal";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { useWallet } from "@/lib/wallet/wallet-context";
import { LiquidityWidget } from "./liquidity-widget";
import {
  LiquiditySettingsGear,
  SwapSettingsGear,
  SwapSettingsProvider,
} from "./swap-settings";
import { SwapWidget } from "./swap-widget";

/** Swap | Limit | Liquidity — one surface for the whole pool. The
 *  settings gear sits to the right of the tabs, per-mode (the Uniswap
 *  placement); Limit brings its own expiration control, so no gear. */
export function TradeSurface({
  assets,
  xcpUsd,
}: {
  assets: string[];
  xcpUsd: number | null;
}) {
  const { address } = useWallet();
  const [mode, setMode] = useState<"swap" | "limit" | "liquidity">("swap");
  const [limitAsset, setLimitAsset] = useState(assets[0] ?? "");
  const [limitSelectorOpen, setLimitSelectorOpen] = useState(false);
  return (
    <SwapSettingsProvider>
      <div className="mb-4 flex items-center justify-between">
        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <SegmentedList className="w-80">
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
        <SwapWidget assets={assets} xcpUsd={xcpUsd} />
      ) : mode === "liquidity" ? (
        <LiquidityWidget assets={assets} xcpUsd={xcpUsd} />
      ) : (
        <div>
          <div className="mb-2 flex items-center gap-2 px-1 text-sm text-gray-500">
            <AssetChip
              asset={limitAsset}
              onClick={
                assets.length > 1
                  ? () => setLimitSelectorOpen(true)
                  : undefined
              }
            />
            <span>/ XCP</span>
          </div>
          <TradePanel key={limitAsset} asset={limitAsset} xcpUsd={xcpUsd} />
          <TokenSelectModal
            open={limitSelectorOpen}
            onClose={() => setLimitSelectorOpen(false)}
            assets={assets}
            selected={limitAsset}
            address={address}
            onSelect={setLimitAsset}
          />
        </div>
      )}
    </SwapSettingsProvider>
  );
}
