import { fetchXcpUsd } from "@/lib/api/price";
import { fetchTradeableAssets } from "@/lib/tradeable";
import { LimitSurface } from "@/app/limit/_components/limit-surface";

export const revalidate = 60;

export const metadata = {
  title: "Limit — xcp.fun",
  description:
    "Place limit orders on graduated XCP-69 launches. Your price is enforced by the order itself — fills through the pool at confirmation or rests on the book.",
};

export default async function LimitPage() {
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
        <LimitSurface assets={assets} xcpUsd={xcpUsd} />
      )}
    </div>
  );
}
