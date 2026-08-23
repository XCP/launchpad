"use client";

import Link from "next/link";
import { useState } from "react";
import { RefreshButton } from "@/components/ui/refresh-button";
import { TokenImage } from "@/components/token-image";
import { Tabs, TabsContent, SegmentedList, SegmentedTrigger } from "@/components/ui/tabs";
import { FOCUS } from "@/components/ui/tokens";
import { useMempool } from "@/hooks/use-mempool";
import { commas, fromSats, shortAddress, tokenQty } from "@/lib/format";
import { groupMintsByAddress } from "@/lib/mempool";

/** The page is being watched, so it polls hard. */
const REFRESH_MS = 10_000;

type Tab = "mints" | "orders" | "fairminters";

export function MempoolView() {
  const { fairminters, mints, orders, isLoading, refresh } = useMempool(REFRESH_MS);

  const groups = groupMintsByAddress(mints);

  // Mints leads, but a mempool with launches queued and no mints opens on
  // Fairminters — the reader always lands on whatever is actually in the
  // mempool. The choice stays derived until the reader clicks a tab
  // themselves; from then on it's theirs and never moves under them.
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const tab =
    chosenTab ??
    (mints.length === 0
      ? orders.length > 0
        ? "orders"
        : fairminters.length > 0
          ? "fairminters"
          : "mints"
      : "mints");

  return (
    <Tabs value={tab} onValueChange={(v) => setChosenTab(v as Tab)}>
      {/* The swap page's header grammar: tabs on the left, the one control on
          the right where its gear sits. No title, no freshness strip — the
          page introduces itself. */}
      <div className="flex items-center justify-between gap-3">
        {/* Two tabs stretched across a 48rem page read as a split view rather
            than a control, so they size to their labels instead. */}
        <SegmentedList className="w-fit">
          <SegmentedTrigger value="mints" grow={false}>
            Mints {mints.length > 0 && `(${mints.length})`}
          </SegmentedTrigger>
          <SegmentedTrigger value="orders" grow={false}>
            Orders {orders.length > 0 && `(${orders.length})`}
          </SegmentedTrigger>
          <SegmentedTrigger value="fairminters" grow={false}>
            Fairminters {fairminters.length > 0 && `(${fairminters.length})`}
          </SegmentedTrigger>
        </SegmentedList>
        <RefreshButton onRefresh={refresh} />
      </div>

      <TabsContent value="mints" className="mt-4">
        {isLoading ? (
          <Empty>Reading the mempool…</Empty>
        ) : groups.length === 0 ? (
          <Empty>Nothing queued — every mint so far has confirmed.</Empty>
        ) : (
          /* Horizontal scroll rather than dropped columns: every number here
             is the point of the table, so none of them is the one to hide. */
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <Th>Minter</Th>
                  <Th>Asset</Th>
                  <Th right>Mints</Th>
                  <Th right>Supply</Th>
                  <Th right>XCP</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {groups.map((g) => (
                  <tr key={g.source}>
                    <td className="whitespace-nowrap p-3">
                      <Link
                        href={`/profile/${g.source}`}
                        className="font-mono text-xs text-gray-600 hover:text-purple-700"
                      >
                        {shortAddress(g.source)}
                      </Link>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {g.assets.map((a) => (
                          <Link
                            key={a}
                            href={`/${a}`}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
                          >
                            {a}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right tabular-nums">{commas(g.mints)}</td>
                    <td className="p-3 text-right tabular-nums">
                      {commas(tokenQty(g.tokensRaw, g.divisible))}
                    </td>
                    <td className="p-3 text-right font-medium tabular-nums">
                      {commas(fromSats(g.xcpRaw))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="orders" className="mt-4">
        {isLoading ? (
          <Empty>Reading the mempool…</Empty>
        ) : orders.length === 0 ? (
          <Empty>No orders queued — every order so far has confirmed.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <Th>Address</Th>
                  <Th>Asset</Th>
                  <Th>Side</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <tr key={o.txHash}>
                    <td className="whitespace-nowrap p-3">
                      <Link href={`/profile/${o.source}`} className="font-mono text-xs text-gray-600 hover:text-purple-700">
                        {shortAddress(o.source)}
                      </Link>
                    </td>
                    <td className="p-3">
                      <Link href={`/${o.asset}`} className="font-medium text-gray-800 hover:text-purple-700">
                        {o.asset}
                      </Link>
                    </td>
                    <td className={`p-3 font-medium ${o.getAsset === o.asset ? "text-green-700" : "text-red-600"}`}>
                      {o.getAsset === o.asset ? "Buy" : "Sell"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="fairminters" className="mt-4">
        {isLoading ? (
          <Empty>Reading the mempool…</Empty>
        ) : fairminters.length === 0 ? (
          <Empty>
            No launches queued. Every XCP-69 launch broadcast so far has
            confirmed.
          </Empty>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {fairminters.map((fm) => (
              /* The whole row opens the launch page (which knows how to render
                 a still-unconfirmed fairminter); a stretched link keeps the
                 issuer's profile link independently clickable on top of it. */
              <li
                key={fm.tx_hash}
                className="relative flex items-center gap-3 p-3 transition-colors hover:bg-gray-50"
              >
                <TokenImage
                  asset={fm.asset}
                  className="size-10 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-gray-900">
                    <Link href={`/${fm.asset}`} className={FOCUS}>
                      <span className="absolute inset-0" aria-hidden />
                      {fm.asset}
                    </Link>
                  </div>
                  <Link
                    href={`/profile/${fm.source}`}
                    className="relative font-mono text-xs text-gray-500 hover:text-purple-700"
                  >
                    {shortAddress(fm.source)}
                  </Link>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-medium text-gray-900 tabular-nums">
                    opens {commas(fm.start_block)}
                  </div>
                  <div className="text-[11px] text-gray-400">unconfirmed</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`p-3 font-medium text-gray-500 ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
      {children}
    </p>
  );
}
