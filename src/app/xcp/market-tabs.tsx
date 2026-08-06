"use client";

import { useState } from "react";
import type { Dispenser } from "@/lib/api/counterparty";
import { DispenserBuy } from "./dispenser-buy";
import { SellDispenser } from "./sell-dispenser";

/**
 * The XCP market as one surface: Buy | Sell tabs over a two-column layout —
 * the form takes two-thirds, a contextual sidebar takes the rest and swaps
 * its explanation with the tab.
 */
export function XcpMarket({
  dispensers,
  btcUsd,
  xcpUsd,
}: {
  dispensers: Dispenser[];
  btcUsd: number | null;
  xcpUsd: number | null;
}) {
  const [tab, setTab] = useState<"buy" | "sell">("buy");

  return (
    <div>
      <div className="flex w-64 items-center gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
        {(["buy", "sell"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-4 py-2 capitalize ${
              tab === t
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "buy" ? "Buy XCP" : "Sell XCP"}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tab === "buy" ? (
            <DispenserBuy dispensers={dispensers} btcUsd={btcUsd} xcpUsd={xcpUsd} />
          ) : (
            <SellDispenser btcUsd={btcUsd} xcpUsd={xcpUsd} />
          )}
        </div>

        <aside className="space-y-4">
          {tab === "buy" ? (
            <>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold">What XCP buys you</h3>
                <ul className="mt-3 space-y-2.5 text-sm font-medium text-gray-800">
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden>⛏️</span>0.01 XCP → one lot (1,000 tokens)
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden>🎯</span>10 XCP → a max mint (1M tokens)
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden>🏷️</span>0.5 XCP → registers a launch name
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span aria-hidden>↩️</span>All of it back if a launch refunds
                  </li>
                </ul>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500">
                <h3 className="text-sm font-semibold text-gray-900">
                  What&apos;s a dispenser?
                </h3>
                <p className="mt-2">
                  An on-chain vending machine: an address escrows XCP and the
                  protocol vends a fixed amount for every increment of BTC it
                  receives — no exchange, no signup, no custody. Rates are set
                  by each operator; the list is sorted cheapest first, and any
                  dispenser with a purchase already pending in the mempool is
                  hidden until it clears. XCP also trades on the DEX and
                  exchanges if you prefer.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold">How selling works</h3>
                <ul className="mt-3 space-y-2.5 text-sm text-gray-700">
                  <li className="flex gap-2.5">
                    <span aria-hidden>🏧</span>
                    <span>
                      Your XCP escrows into a vending machine at your price —
                      the protocol handles every sale.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <span aria-hidden>⚡</span>
                    <span>
                      BTC lands on your address automatically with each vend.
                      No counterparty, no custody.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <span aria-hidden>1️⃣</span>
                    <span>
                      Vends 1 XCP at a time — the format this site&apos;s buy
                      list shows, so your dispenser appears there.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <span aria-hidden>🔓</span>
                    <span>
                      One open dispenser per asset per address. Close any time
                      to reclaim whatever hasn&apos;t sold.
                    </span>
                  </li>
                </ul>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-500">
                <h3 className="text-sm font-semibold text-gray-900">Pricing</h3>
                <p className="mt-2">
                  The form prefills the live market rate. Price above market
                  and you earn a premium but vend slower; below market and you
                  vend fast for less. Buyers here see your rate compared to
                  market before they buy.
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
