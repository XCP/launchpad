import { fetchXcpDispensers } from "@/lib/api/counterparty";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { DispenserBuy } from "./dispenser-buy";

export const revalidate = 60;

export const metadata = {
  title: "Get XCP — xcp.fun",
  description:
    "Minting costs XCP: 0.01 XCP per 1,000-token lot, 10 XCP for a max mint. Buy XCP from an on-chain dispenser — send BTC, the protocol vends automatically.",
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
          Minting runs on XCP, Counterparty&apos;s native token: 0.01 XCP per
          1,000-token lot, 10 XCP for a max mint, and 0.5 XCP to register a
          name if you&apos;re launching. Your BTC only pays miner fees — the
          XCP has to sit on your address&apos;s Counterparty balance.
        </p>
      </div>

      <DispenserBuy dispensers={dispensers} btcUsd={btcUsd} xcpUsd={xcpUsd} />

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500">
        <p>
          <strong className="text-gray-700">What&apos;s a dispenser?</strong>{" "}
          An on-chain vending machine: an address that escrows XCP and vends a
          fixed amount for every increment of BTC it receives, enforced by the
          Counterparty protocol — no exchange, no signup, no custody. Rates
          are set by each dispenser&apos;s operator; the list above is sorted
          cheapest first (oracle-priced dispensers are excluded). XCP also
          trades on the DEX and on exchanges if you prefer.
        </p>
      </div>
    </div>
  );
}
