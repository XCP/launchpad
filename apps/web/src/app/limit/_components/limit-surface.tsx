"use client";

import { useState } from "react";
import { TradePanel } from "@/app/[asset]/_components/trade-panel";
import {
  LimitSettingsGear,
  SwapSettingsProvider,
} from "@/app/swap/_components/swap-settings";
import { TokenSelectModal } from "@/components/token-select-modal";
import { SegmentedList, SegmentedTrigger, Tabs } from "@/components/ui/tabs";
import { useWallet } from "@/lib/wallet/wallet-context";
import { defaultTradeAsset } from "@/lib/trade-selection";

/** The limit page: Buy | Sell in the tab row (its gear beside them), the
 *  order form below. Same silhouette as /swap. */
export function LimitSurface({
  assets,
  xcpUsd,
}: {
  assets: string[];
  xcpUsd: number | null;
}) {
  const { address } = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [asset, setAsset] = useState(() => defaultTradeAsset(assets));
  const [selectorOpen, setSelectorOpen] = useState(false);
  return (
    <SwapSettingsProvider>
      <div className="mb-4 flex items-center justify-between">
        <Tabs value={side} onValueChange={(v) => setSide(v as typeof side)}>
          <SegmentedList className="w-64">
            {(["buy", "sell"] as const).map((s) => (
              <SegmentedTrigger key={s} value={s}>
                {s}
              </SegmentedTrigger>
            ))}
          </SegmentedList>
        </Tabs>
        <LimitSettingsGear />
      </div>
      <TradePanel
        key={asset}
        asset={asset}
        xcpUsd={xcpUsd}
        side={side}
        onOpenSelector={
          assets.length > 1 ? () => setSelectorOpen(true) : undefined
        }
      />
      <TokenSelectModal
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        assets={assets}
        selected={asset}
        address={address}
        onSelect={setAsset}
      />
    </SwapSettingsProvider>
  );
}
