"use client";

import { TokenImage } from "@/components/token-image";

const SHELL =
  "flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-2 pr-3 shadow-sm";

/**
 * The token identity chip that sits in every well. With onClick it's a
 * selector (chevron, hover, press); without, pure identity.
 */
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
        className="size-6 rounded-full bg-gray-100 object-cover"
      />
      <span className="text-sm font-semibold">{asset}</span>
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
      <span aria-hidden className="text-xs text-gray-400">
        ▾
      </span>
    </button>
  );
}

export function XcpChip() {
  return (
    <div className={SHELL}>
      <span className="flex size-6 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
        X
      </span>
      <span className="text-sm font-semibold">XCP</span>
    </div>
  );
}

export function BtcChip() {
  return (
    <div className={SHELL}>
      <span className="flex size-6 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
        ₿
      </span>
      <span className="text-sm font-semibold">BTC</span>
    </div>
  );
}
