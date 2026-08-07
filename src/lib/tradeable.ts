import {
  fetchAllFairminters,
  fetchOriginalDeadline,
  fetchPool,
} from "@/lib/api/counterparty";
import { isXcp69, windowIsExact } from "@/lib/xcp69";
import { SHOW_NONCONFORMING } from "@/utils/constants";

/**
 * Classic Counterparty pools seeded into the picker until the first XCP-69
 * graduates exist — real liquidity beats an empty placeholder. Each is
 * verified live (dropped if its pool disappears).
 */
const LEGACY_POOLS = ["PEPECASH"];

/**
 * Tradeable = graduated XCP-69 (conforming, with a live pool) plus verified
 * legacy pools, deepest first. One leg is always XCP.
 */
export async function fetchTradeableAssets(): Promise<string[]> {
  const fairminters = await fetchAllFairminters();
  const closedPoolFms = fairminters.filter(
    (fm) => fm.status === "closed" && (fm.pool_quantity ?? 0) > 0,
  );
  const withPools = await Promise.all(
    closedPoolFms.map(async (fm) => {
      const pool = await fetchPool(fm.asset);
      if (!pool) return null;
      const conforming =
        isXcp69(fm) && windowIsExact(fm, await fetchOriginalDeadline(fm.tx_hash));
      if (!conforming && !SHOW_NONCONFORMING) return null;
      const xcpDepth = pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b;
      return { asset: fm.asset, xcpDepth };
    }),
  );
  const graduates = withPools
    .filter((p): p is { asset: string; xcpDepth: number } => p !== null)
    .sort((a, b) => b.xcpDepth - a.xcpDepth)
    .map((p) => p.asset);
  const legacy = (
    await Promise.all(
      LEGACY_POOLS.filter((a) => !graduates.includes(a)).map(async (a) =>
        (await fetchPool(a)) ? a : null,
      ),
    )
  ).filter((a): a is string => a !== null);
  return [...graduates, ...legacy];
}
