"use client";

import { TokenImage } from "@/components/token-image";

/**
 * One pill for every asset, XCP and BTC included — real icons, not letter
 * badges. Fixed width sized for a 12-character name so pills are identical
 * across any pair (3 to 12 chars), content left-aligned within.
 */
const SHELL =
  "flex w-36 shrink-0 items-center justify-start gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm";

export function AssetChip({
  asset,
  onClick,
}: {
  asset: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <TokenImage
        asset={asset}
        className="size-6 shrink-0 rounded-full bg-gray-100 object-cover"
      />
      <span className="min-w-0 truncate text-sm font-semibold">{asset}</span>
    </>
  );
  if (!onClick) return <div className={SHELL}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${SHELL} transition-all hover:border-gray-300 hover:shadow active:scale-[0.97]`}
    >
      {inner}
      <span aria-hidden className="ml-auto text-xs text-gray-400">
        ▾
      </span>
    </button>
  );
}

export function XcpChip() {
  return <AssetChip asset="XCP" />;
}

export function BtcChip() {
  return <AssetChip asset="BTC" />;
}
