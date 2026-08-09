import { fetchXcpDispensers } from "@/lib/api/counterparty";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { XcpBridge } from "./bridge";

export const revalidate = 60;

export const metadata = {
  title: "Get XCP — xcp.fun",
  description:
    "Load your wallet with XCP straight from Bitcoin — or unload it back. Minting costs XCP: 0.01 XCP per 1,000-token lot, 10 XCP for a max mint.",
};

export default async function GetXcpPage() {
  const [dispensers, btcUsd, xcpUsd] = await Promise.all([
    fetchXcpDispensers(),
    fetchBtcUsd(),
    fetchXcpUsd(),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-3xl">
      <XcpBridge dispensers={dispensers} btcUsd={btcUsd} xcpUsd={xcpUsd} />

    </div>
  );
}
