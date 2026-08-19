/** Percentage move from an explicit price baseline. */
export function priceChangePercent(price: number, baseline: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(baseline) || price <= 0 || baseline <= 0) {
    return null;
  }
  return (price / baseline - 1) * 100;
}
