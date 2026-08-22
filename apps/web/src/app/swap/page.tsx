import { fetchXcpUsd } from "@/lib/api/price";
import { fetchTradeableAssets } from "@/lib/tradeable";
import { TradeSurface } from "@/app/swap/_components/trade-surface";

export const revalidate = 60;

export const metadata = {
  title: "Swap — xcp.fun",
  description:
    "Swap graduated XCP-69 assets through Counterparty pools and the order book, including direct token pairs when liquidity exists.",
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
