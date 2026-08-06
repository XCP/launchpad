import {
  fetchAllFairminters,
  fetchOriginalDeadline,
  fetchPool,
} from "@/lib/api/counterparty";
import { fetchXcpUsd } from "@/lib/api/price";
import { isXcp69, windowIsExact } from "@/lib/xcp69";
import { SHOW_NONCONFORMING } from "@/utils/constants";
import { TradeSurface } from "./trade-surface";

export const revalidate = 60;

export const metadata = {
  title: "Swap — xcp.fun",
  description:
    "Swap XCP against graduated XCP-69 launches. Every pair trades against permanently locked liquidity — pool and order book, best price first.",
};

/**
 * Classic Counterparty pools seeded into the picker until the first XCP-69
 * graduates exist — real liquidity beats an empty placeholder. Each is
 * verified live (dropped if its pool disappears).
 */
const LEGACY_POOLS = ["PEPECASH"];

export default async function SwapPage() {
  const [fairminters, xcpUsd] = await Promise.all([
    fetchAllFairminters(),
    fetchXcpUsd(),
  ]);

  // Tradeable = graduated XCP-69: conforming (incl. the exact-window event
  // check for closed records) with a live pool. One leg is always XCP.
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
  const assets = [...graduates, ...legacy];

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Swap</h1>
        <p className="mt-2 text-sm text-gray-600">
          XCP on one side, a graduated XCP-69 launch on the other.
          {legacy.length > 0 &&
            " Until the first launch graduates, classic Counterparty pools like PEPECASH stand in."}
        </p>
      </div>

      {assets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          No launches have graduated yet. The first sell-out seeds the first
          pool — and it becomes tradeable here in the same block.
        </p>
      ) : (
        <TradeSurface assets={assets} xcpUsd={xcpUsd} />
      )}
    </div>
  );
}
