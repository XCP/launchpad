import {
  fetchAllFairminters,
  fetchOriginalRecord,
  fetchPool,
} from "@/lib/api/counterparty";
import { fetchTradeableFromIndex } from "@/lib/api/launchpad-api";
import { mapWithLimit } from "@/lib/net";
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
 * verified special pools, deepest first. Every listed token has an XCP
 * reference pool; the swap form may pair any two listed tokens when a direct
 * pool or order-book market exists.
 *
 * The graduate half comes from our own index. apps/api derives `conforming`
 * and `phase` once per launch and refreshes `pool_xcp_sats` on its cron, so
 * this is a question it has already answered — see deriveGraduatesFromNode
 * for what asking Counterparty instead actually costs.
 *
 * The special pools stay a live check because they are not launches and the
 * index has no row for them. Two reads, coalesced by the client.
 */
export async function fetchTradeableAssets(): Promise<string[]> {
  const graduates = (await fetchTradeableFromIndex()) ?? (await deriveGraduatesFromNode());
  const specials = (
    await mapWithLimit(
      SPECIAL_POOLS.filter((a) => !graduates.includes(a)),
      async (a) => ((await fetchPool(a)) ? a : null),
    )
  ).filter((a): a is string => a !== null);
  return orderTradeAssets([...graduates, ...specials]);
}

/**
 * The same set, derived live from Counterparty. The fallback, and only that.
 *
 * This is what the page used to do on every render: the whole fairminter list,
 * a pool read per closed launch, and a creation-event read per launch to
 * re-judge conformance. Roughly 260 requests at a public node, repeated for
 * each of eleven locales on every build and every revalidation. Measured on
 * one production build, that was 24,970 requests to satisfy 441 distinct
 * reads, and the node answered 24,306 of them with 429.
 *
 * It stays here because the index is a cache with provenance, not a new source
 * of truth: nothing above is the only place these facts live, and a bad deploy
 * of apps/api should degrade this page's speed, not its honesty. It is a net,
 * not a mode to run in.
 */
async function deriveGraduatesFromNode(): Promise<string[]> {
  const fairminters = await fetchAllFairminters();
  const closedPoolFms = fairminters.filter(
    (fm) => fm.status === "closed" && big(fm.pool_quantity) > 0n,
  );
  // Two reads per element against a list that grows with every graduated
  // launch. Unbounded, this alone asks for hundreds of subrequests at once and
  // spends the render cancelling itself; see lib/net.ts.
  const withPools = await mapWithLimit(closedPoolFms, async (fm) => {
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
  });
  return withPools
    .filter((p): p is { asset: string; xcpDepth: Raw } => p !== null)
    .sort((a, b) => compareRawDesc(a.xcpDepth, b.xcpDepth))
    .map((p) => p.asset);
}
