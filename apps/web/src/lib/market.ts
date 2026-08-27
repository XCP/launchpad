/** Percentage move from an explicit price baseline. */
export function priceChangePercent(price: number, baseline: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(baseline) || price <= 0 || baseline <= 0) {
    return null;
  }
  return (price / baseline - 1) * 100;
}

/** Token return in dollars from its fixed launch baseline. TOKEN/XCP alone
 * measures only the token's move against XCP; multiplying each side by the
 * XCP/USD rate that applied then makes XCP's own dollar move part of the
 * result too. */
export function usdPriceChangePercent(
  currentPriceXcp: number,
  currentXcpUsd: number | null,
  launchPriceXcp: number,
  launchXcpUsd: number | null,
): number | null {
  if (currentXcpUsd === null || launchXcpUsd === null) return null;
  return priceChangePercent(
    currentPriceXcp * currentXcpUsd,
    launchPriceXcp * launchXcpUsd,
  );
}

/** Last daily mark at or before a timestamp. Missing dates carry the previous
 * close; a timestamp before the calendar never borrows a future price. */
export function historicalUsdAt(
  history: { day: string; usd: number }[],
  unixSeconds: number,
): number | null {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  const day = new Date(unixSeconds * 1000).toISOString().slice(0, 10);
  let found: number | null = null;
  for (const row of history) {
    if (row.day <= day) found = row.usd;
    else break;
  }
  return found;
}
