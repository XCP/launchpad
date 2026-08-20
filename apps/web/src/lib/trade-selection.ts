/** The house rewards market is the neutral starting pair for standalone trade forms. */
export const DEFAULT_TRADE_ASSET = "MINTS";

/** Prefer MINTS when it is actually tradeable; otherwise keep the server's
 * liquidity-ranked fallback rather than manufacturing an unavailable pair. */
export function defaultTradeAsset(assets: string[]): string {
  return assets.includes(DEFAULT_TRADE_ASSET)
    ? DEFAULT_TRADE_ASSET
    : (assets[0] ?? "");
}

/** A stable selector order: MINTS first, then the server's existing depth
 * order. This never depends on wallet data that can arrive after opening. */
export function orderTradeAssets(assets: string[]): string[] {
  const preferred = assets.filter((asset) => asset === DEFAULT_TRADE_ASSET);
  const rest = assets.filter((asset) => asset !== DEFAULT_TRADE_ASSET);
  return [...preferred, ...rest];
}
