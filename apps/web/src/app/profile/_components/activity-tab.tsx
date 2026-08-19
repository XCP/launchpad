"use client";

import Link from "next/link";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { fetchAssetBalance, fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchEventsBySource, fetchIndexedLaunches, fetchMintsBySource } from "@/lib/api/launchpad-api";
import { computeActivity, reconcileActivity, type ActivityKind } from "@/lib/activity";
import { compact, fromSats, tokenQty } from "@/lib/format";

const LABEL: Record<ActivityKind, string> = {
  mint: "Minted",
  mint_pending: "Mint open",
  refund: "Refunded",
  buy: "Bought",
  sell: "Sold",
  movement_in: "Other in",
  movement_out: "Other out",
};

const TONE: Record<ActivityKind, string> = {
  mint: "bg-purple-100 text-purple-700",
  mint_pending: "bg-amber-100 text-amber-700",
  refund: "bg-gray-100 text-gray-600",
  buy: "bg-green-100 text-green-700",
  sell: "bg-red-100 text-red-700",
  movement_in: "bg-blue-100 text-blue-700",
  movement_out: "bg-gray-100 text-gray-600",
};

/** Blocks land about every ten minutes, so distance from the tip is a decent
 *  age — an estimate, and labelled as one. */
function ago(blocks: number): string {
  const mins = blocks * 10;
  if (mins < 60) return `~${Math.max(1, Math.round(mins))}m ago`;
  if (mins < 60 * 24) return `~${Math.round(mins / 60)}h ago`;
  return `~${Math.round(mins / (60 * 24))}d ago`;
}

export function ActivityTab({ address }: { address: string }) {
  const { data, isLoading } = useSWR(
    ["activity", address],
    async () => {
      const [launches, events, mints, height] = await Promise.all([
        fetchIndexedLaunches(50),
        fetchEventsBySource(address),
        fetchMintsBySource(address),
        fetchBlockHeight(),
      ]);
      // Every conforming launch, not just graduated ones: a mint that is still
      // open is activity, and so is a refund from one that failed.
      const universe = new Map((launches ?? []).map((l) => [l.fm.asset, l.fm.divisible]));
      const focused = computeActivity(events ?? [], mints ?? [], universe);
      const assets = [...new Set(focused.map((row) => row.asset))];
      const balances = new Map(
        await Promise.all(
          assets.map(async (asset) => [asset, await fetchAssetBalance(address, asset)] as const),
        ),
      );
      return { rows: reconcileActivity(focused, balances), height };
    },
    { refreshInterval: 600_000, revalidateOnFocus: false },
  );

  if (isLoading) return <p className="p-6 text-center text-sm text-gray-400">Loading activity…</p>;

  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        No mints, trades, or transfers on xcp.fun launches yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Same table grammar as the holders list: fixed columns under their own
          headings, so the token names line up instead of being pushed around
          by however wide each status label happens to be. */}
      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_5rem] gap-x-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            <span>Token</span>
            <span>Type</span>
            <span className="text-right">Amount</span>
            <span className="text-right">XCP</span>
            <span className="text-right">When</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {rows.map((r) => {
              const tokensIn = r.tokenDelta >= 0n;
              const tokens = tokenQty((tokensIn ? r.tokenDelta : -r.tokenDelta).toString(), r.divisible);
              const xcpOut = r.xcpDelta < 0n;
              const xcp = fromSats((xcpOut ? -r.xcpDelta : r.xcpDelta).toString());
              return (
                <li
                  key={r.key}
                  className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_5rem] items-center gap-x-4 py-2.5 text-sm"
                >
                  <Link href={`/${r.asset}`} className="flex min-w-0 items-center gap-2 hover:text-purple-600">
                    <TokenImage asset={r.asset} className="size-6 shrink-0 rounded" />
                    <span className="truncate font-medium">{r.asset}</span>
                  </Link>
                  <span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.kind]}`}>
                      {LABEL[r.kind]}
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-gray-900">
                    {/* A refund moves XCP and no tokens; "+0" is noise. */}
                    {r.tokenDelta === 0n ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <>
                        {tokensIn ? "+" : "−"}
                        {compact(tokens)}
                      </>
                    )}
                  </span>
                  <span className="text-right tabular-nums text-gray-500">
                    {r.xcpDelta === 0n ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <>
                        {xcpOut ? "−" : "+"}
                        {compact(xcp)}
                      </>
                    )}
                  </span>
                  <span className="text-right text-xs text-gray-400">
                    {r.block === null
                      ? "other"
                      : data?.height
                        ? ago(data.height - r.block)
                        : `block ${r.block}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Mints, refunds, and pool or order-book fills on XCP-69 launches. “Other”
        reconciles those events to the live balance and can represent a send,
        receive, burn, or liquidity movement. An open
        mint shows what you&apos;ve committed — that XCP is escrowed by
        consensus and comes back automatically if the launch misses its soft
        cap.
      </p>
    </div>
  );
}
