"use client";

import Link from "next/link";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import {
  fetchMempoolSnapshot,
  fetchMintsBySource,
} from "@/lib/api/launchpad-api";
import { commasRaw } from "@/lib/format";
import { big } from "@/lib/numeric";

interface OpenMint {
  asset: string;
  divisible: boolean;
  earned: bigint;
  paid: bigint;
  mints: number;
  pendingEarned: bigint;
  pendingPaid: bigint;
  pendingMints: number;
}

export function MintingTab({ address }: { address: string }) {
  const { data: mints, isLoading } = useSWR(
    ["open-mints", address],
    () => fetchMintsBySource(address),
    { refreshInterval: 30_000 },
  );
  const { data: mempool } = useSWR(
    ["open-mints-mempool", address],
    async () => {
      const snapshot = await fetchMempoolSnapshot();
      return snapshot?.mints.filter((mint) => mint.source === address) ?? [];
    },
    { refreshInterval: 15_000 },
  );

  const byAsset = new Map<string, OpenMint>();
  for (const mint of mints ?? []) {
    if (mint.phase !== "minting") continue;
    const row = byAsset.get(mint.asset) ?? emptyMint(mint.asset, mint.divisible);
    row.earned += big(mint.earned);
    row.paid += big(mint.paid);
    row.mints += 1;
    byAsset.set(mint.asset, row);
  }

  // A tx can appear in both feeds during the indexer's short catch-up window.
  // Count it as confirmed once the indexed mint exists rather than showing the
  // same XCP as both committed and waiting.
  const confirmedTxids = new Set((mints ?? []).map((mint) => mint.txHash));
  for (const mint of mempool ?? []) {
    if (confirmedTxids.has(mint.txHash)) continue;
    const row = byAsset.get(mint.asset) ?? emptyMint(mint.asset, mint.divisible);
    row.pendingEarned += big(mint.earnQuantity);
    row.pendingPaid += big(mint.paidQuantity);
    row.pendingMints += 1;
    byAsset.set(mint.asset, row);
  }

  const rows = [...byAsset.values()].sort((a, b) => {
    const left = a.paid + a.pendingPaid;
    const right = b.paid + b.pendingPaid;
    return left === right ? a.asset.localeCompare(b.asset) : left > right ? -1 : 1;
  });
  const committed = rows.reduce((sum, row) => sum + row.paid, 0n);
  const pending = rows.reduce((sum, row) => sum + row.pendingPaid, 0n);

  if (isLoading) {
    return <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">Loading open mints…</p>;
  }

  if (mints === null) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Couldn&apos;t reach the mint index—try again shortly.
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No XCP committed to open mints right now.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
          XCP committed
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            {commasRaw(committed)} XCP
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            across {rows.filter((row) => row.paid > 0n).length}{" "}
            open {rows.filter((row) => row.paid > 0n).length === 1 ? "launch" : "launches"}
          </p>
        </div>
        {pending > 0n && (
          <p className="mt-1 text-xs tabular-nums text-amber-700 dark:text-amber-400">
            + {commasRaw(pending)} XCP waiting to confirm
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          This XCP is escrowed by consensus. It returns automatically if a
          launch misses its soft cap; if the launch graduates, you receive the
          tokens shown below instead.
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className="grid grid-cols-[minmax(0,1fr)_5rem_8rem_8rem] gap-x-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <span>Token</span>
            <span className="text-right">Mints</span>
            <span className="text-right">If launched</span>
            <span className="text-right">XCP committed</span>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row) => (
              <li
                key={row.asset}
                className="grid grid-cols-[minmax(0,1fr)_5rem_8rem_8rem] items-center gap-x-4 py-2.5 text-sm"
              >
                <Link
                  href={`/${row.asset}`}
                  className="flex min-w-0 items-center gap-2 hover:text-purple-600 dark:hover:text-purple-400"
                >
                  <TokenImage asset={row.asset} className="size-7 shrink-0 rounded" />
                  <span className="truncate font-medium">{row.asset}</span>
                  {row.pendingMints > 0 && (
                    <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      pending
                    </span>
                  )}
                </Link>
                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {row.mints}
                  {row.pendingMints > 0 ? ` +${row.pendingMints}` : ""}
                </span>
                <span className="text-right tabular-nums text-gray-900 dark:text-gray-100">
                  {commasRaw(
                    row.earned + row.pendingEarned,
                    row.divisible ? 8 : 0,
                  )}
                </span>
                <span className="text-right tabular-nums text-gray-900 dark:text-gray-100">
                  {commasRaw(row.paid)}
                  {row.pendingPaid > 0n && (
                    <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                      +{commasRaw(row.pendingPaid)} pending
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function emptyMint(asset: string, divisible: boolean): OpenMint {
  return {
    asset,
    divisible,
    earned: 0n,
    paid: 0n,
    mints: 0,
    pendingEarned: 0n,
    pendingPaid: 0n,
    pendingMints: 0,
  };
}
