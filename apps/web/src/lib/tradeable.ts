import {
  fetchAllFairminters,
  fetchOriginalRecord,
  fetchPool,
} from "@/lib/api/counterparty";
import { big, compareRawDesc, type Raw } from "@/lib/numeric";
import { isXcp69, windowIsExact, xcp69Params } from "@/lib/xcp69";
import { orderTradeAssets } from "@/lib/trade-selection";

/**
 * The house pools beside the graduates: PEPECASH (the classic) and MINTS
 * (the rewards asset — the same MINTS/XCP pool that prices the programme).
 * Each verified live (dropped if its pool disappears). Divisible assets
 * only: BITCORN/XCP is real and liquid but BITCORN is indivisible, and
 * every trading surface here does its money math at 8 decimals — listing
 * it without threading divisibility through swap/liquidity/limit would
 * misprice it by 1e8.
 */
const SPECIAL_POOLS = ["PEPECASH", "MINTS"];

/**
 * Tradeable = graduated XCP-69 (conforming, with a live pool) plus the
 * verified special pools, deepest first. One leg is always XCP.
 */
export async function fetchTradeableAssets(): Promise<string[]> {
  const fairminters = await fetchAllFairminters();
  const closedPoolFms = fairminters.filter(
    (fm) => fm.status === "closed" && big(fm.pool_quantity) > 0n,
  );
  const withPools = await Promise.all(
    closedPoolFms.map(async (fm) => {
      const pool = await fetchPool(fm.asset);
      if (!pool) return null;
      const original = xcp69Params(fm)
        ? await fetchOriginalRecord(fm.tx_hash)
        : { deadline: null, announceBlock: null };
      const conforming =
        isXcp69(fm, original.announceBlock) &&
        windowIsExact(fm, original.deadline);
      if (!conforming) return null;
      const xcpDepth = pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b;
      return { asset: fm.asset, xcpDepth };
    }),
  );
  const graduates = withPools
    .filter((p): p is { asset: string; xcpDepth: Raw } => p !== null)
    .sort((a, b) => compareRawDesc(a.xcpDepth, b.xcpDepth))
    .map((p) => p.asset);
  const specials = (
    await Promise.all(
      SPECIAL_POOLS.filter((a) => !graduates.includes(a)).map(async (a) =>
        (await fetchPool(a)) ? a : null,
      ),
    )
  ).filter((a): a is string => a !== null);
  return orderTradeAssets([...graduates, ...specials]);
}
