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
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Get XCP</h1>
        <p className="mt-2 text-sm text-gray-600">
          Minting runs on XCP. Load your wallet straight from Bitcoin — send
          BTC, XCP lands next block — or unload it back the same way.
        </p>
      </div>

      <XcpBridge dispensers={dispensers} btcUsd={btcUsd} xcpUsd={xcpUsd} />

      <p className="text-center text-xs text-gray-400">
        0.01 XCP mints a 1,000-token lot · 10 XCP is a full max mint · refunded
        launches return XCP
      </p>
    </div>
  );
}
