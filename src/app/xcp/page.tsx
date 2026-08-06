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
          Minting runs on XCP — it has to sit on your address&apos;s
          Counterparty balance. Your BTC only ever pays miner fees.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold">What XCP buys you</h2>
        <ul className="mt-3 grid gap-x-6 gap-y-3 text-sm font-medium text-gray-800 sm:grid-cols-2">
          <li className="flex items-center gap-2.5">
            <span aria-hidden>⛏️</span>0.01 XCP → one lot (1,000 tokens)
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>🎯</span>10 XCP → a max mint (1,000,000 tokens)
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>🏷️</span>0.5 XCP → registers a launch name
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>↩️</span>All of it back if a launch refunds
          </li>
        </ul>
      </div>

      <DispenserBuy dispensers={dispensers} btcUsd={btcUsd} xcpUsd={xcpUsd} />

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500">
        <p>
          <strong className="text-gray-700">What&apos;s a dispenser?</strong>{" "}
          An on-chain vending machine: an address escrows XCP and the protocol
          vends a fixed amount for every increment of BTC it receives — no
          exchange, no signup, no custody. Rates are set by each operator;
          the list is sorted cheapest first. XCP also trades on the DEX and
          exchanges if you prefer.
        </p>
      </div>
    </div>
  );
}
