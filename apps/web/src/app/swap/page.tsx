import { fetchXcpUsd } from "@/lib/api/price";
import { fetchTradeableAssets } from "@/lib/tradeable";
import { TradeSurface } from "./trade-surface";

export const revalidate = 60;

export const metadata = {
  title: "Swap — xcp.fun",
  description:
    "Swap XCP against graduated XCP-69 launches. Every pair trades against permanently locked liquidity — pool and order book, best price first.",
};

export default async function SwapPage() {
  const [assets, xcpUsd] = await Promise.all([
    fetchTradeableAssets(),
    fetchXcpUsd(),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
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
