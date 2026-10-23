import type { LaunchStats } from "@/lib/api/launchpad-api";

export const ACTIVITY_WINDOWS = [7, 28, 90] as const;
export type ActivityWindow = typeof ACTIVITY_WINDOWS[number];

/** Zero-fill whole, aligned block buckets. Only the newest is partial.
 * Preserve raw integers until the chart/display boundary. */
export function statsActivity(stats: LaunchStats, days: ActivityWindow) {
  if (!stats.ecosystem || stats.ecosystem.height <= 0) return null;
  const newest = Math.floor(stats.ecosystem.height / stats.blocks_per_bucket);
  const first = newest - days + 1;
  const mints = new Map(stats.daily.map(d => [d.bucket, d.n]));
  const trades = new Map(stats.ecosystem.trades_daily.map(d => [d.bucket, d]));
  const burns = new Map<number, number>();
  const assets = new Map<string, { asset: string; divisible: boolean; n: number; quantity: bigint }>();
  for (const row of stats.ecosystem.burns_daily) {
    if (row.bucket < first || row.bucket > newest) continue;
    burns.set(row.bucket, (burns.get(row.bucket) ?? 0) + row.n);
    const asset = assets.get(row.asset) ?? { asset: row.asset, divisible: !!row.divisible, n: 0, quantity: 0n };
    asset.n += row.n;
    asset.quantity += BigInt(row.quantity);
    assets.set(row.asset, asset);
  }
  const series = Array.from({ length: days }, (_, i) => {
    const bucket = first + i;
    const trade = trades.get(bucket);
    return { bucket, mints: mints.get(bucket) ?? 0, fills: trade?.n ?? 0,
      xcp: BigInt(trade?.xcp ?? "0"), burns: burns.get(bucket) ?? 0 };
  });
  const totals = series.reduce((a, d) => ({ mints: a.mints + d.mints, fills: a.fills + d.fills,
    xcp: a.xcp + d.xcp, burns: a.burns + d.burns }), { mints: 0, fills: 0, xcp: 0n, burns: 0 });
  return { series, totals, assets: [...assets.values()].sort((a, b) => b.n - a.n || a.asset.localeCompare(b.asset)) };
}
