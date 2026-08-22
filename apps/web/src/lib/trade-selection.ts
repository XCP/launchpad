/** The house rewards market is the neutral starting pair for standalone trade forms. */
export const DEFAULT_TRADE_ASSET = "MINTS";

/** Prefer MINTS when it is actually tradeable; otherwise keep the server's
 * liquidity-ranked fallback rather than manufacturing an unavailable pair. */
export function defaultTradeAsset(assets: string[]): string {
  return assets.includes(DEFAULT_TRADE_ASSET)
    ? DEFAULT_TRADE_ASSET
    : (assets[0] ?? "");
}

export type TradePairLeg = "give" | "get";

/**
 * Change one side of a pair without ever producing a same-asset swap.
 * Choosing the opposite side's asset flips the pair — familiar DEX behavior
 * — while every other choice changes only the side the user opened.
 */
export function selectTradeAsset(
  giveAsset: string,
  getAsset: string,
  leg: TradePairLeg,
  nextAsset: string,
): { giveAsset: string; getAsset: string } {
  if (leg === "give") {
    if (nextAsset === giveAsset) return { giveAsset, getAsset };
    return nextAsset === getAsset
      ? { giveAsset: nextAsset, getAsset: giveAsset }
      : { giveAsset: nextAsset, getAsset };
  }
  if (nextAsset === getAsset) return { giveAsset, getAsset };
  return nextAsset === giveAsset
    ? { giveAsset: getAsset, getAsset: nextAsset }
    : { giveAsset, getAsset: nextAsset };
}

/** A stable selector order: MINTS first, then the server's existing depth
 * order. This never depends on wallet data that can arrive after opening. */
export function orderTradeAssets(assets: string[]): string[] {
  const preferred = assets.filter((asset) => asset === DEFAULT_TRADE_ASSET);
  const rest = assets.filter((asset) => asset !== DEFAULT_TRADE_ASSET);
  return [...preferred, ...rest];
}
