"use client";

import { TokenImage } from "@/components/token-image";

/**
 * One pill for every asset, XCP and BTC included — real icons, not letter
 * badges. Pills hug their content (Radiant/Uniswap convention) with a cap
 * so a runaway subasset name truncates instead of crushing the amount.
 */
const SHELL =
  "flex max-w-44 shrink-0 items-center justify-start gap-2 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-1.5 pl-2 pr-3 shadow-sm";

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
        className="size-6 shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 object-cover"
      />
      <span className="min-w-0 truncate text-sm font-semibold">{asset}</span>
    </>
  );
  if (!onClick) return <div className={SHELL}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${SHELL} transition-all hover:border-gray-300 dark:hover:border-gray-700 hover:shadow active:scale-[0.97]`}
    >
      {inner}
      <span aria-hidden className="ml-auto text-xs text-gray-400 dark:text-gray-500">
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
