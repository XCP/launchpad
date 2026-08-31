"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { pendingPressureByAsset, type PendingPressure } from "@/app/research/_lib/behavior";
import { useMempool } from "@/hooks/use-mempool";
import {
  fetchResearchBehavior,
  type ResearchLaunchBehavior,
  type ResearchBehaviorSnapshot,
} from "@/lib/api/launchpad-api";
import { compact, fromSats } from "@/lib/format";
import { big, ratio } from "@/lib/numeric";
import { circulatingSupplyRaw } from "@/lib/xcp69";

const EMPTY_PENDING: PendingPressure = {
  sellTransactions: 0,
  sellWallets: 0,
  sellQuantity: 0n,
  buyTransactions: 0,
  buyWallets: 0,
};

export function LiveBehaviorDashboard() {
  const { data, isLoading } = useSWR("research:behavior", fetchResearchBehavior, {
    refreshInterval: 300_000,
    dedupingInterval: 300_000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const { orders } = useMempool(15_000);
  const pending = useMemo(() => pendingPressureByAsset(orders), [orders]);
  const pendingSells = useMemo(
    () =>
      [...pending.entries()]
        .filter(([, row]) => row.sellTransactions > 0)
        .sort((a, b) =>
          a[1].sellQuantity === b[1].sellQuantity
            ? b[1].sellWallets - a[1].sellWallets
            : a[1].sellQuantity > b[1].sellQuantity
              ? -1
              : 1,
        ),
    [pending],
  );

  if (isLoading && !data) {
    return (
      <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 text-sm text-gray-500 dark:text-gray-400">
        Loading launch dynamics…
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-5 text-sm text-amber-900 dark:text-amber-200">
        Launch dynamics are temporarily unavailable.
      </section>
    );
  }

  return (
    <section id="live-behavior" className="scroll-mt-6 space-y-6">
      <PendingSellTape rows={pendingSells} />

      <SellerSummary cohorts={data.cohorts} />

      <LaunchTable
        mode="minting"
        title="Minting now"
        subtitle="Ranked by progress"
        rows={data.launches.filter((row) => row.phase === "minting")}
        pending={pending}
      />

      <LaunchTable
        mode="graduated"
        title="After graduation"
        subtitle="Ranked by market cap"
        rows={data.launches.filter((row) => row.phase === "graduated")}
        pending={pending}
      />

      <p className="text-xs leading-relaxed text-gray-400 dark:text-gray-500">
        Each number counts unique addresses. A sale is a pool or order-book sale captured by xcp.fun.
        Dump means the address sold within {data.fastExitBlocks} blocks of graduation. A meaningful
        balance is more than one token and more than 1% of the address&apos;s acquired amount.
      </p>
    </section>
  );
}

export function SellerSummary({
  cohorts,
}: {
  cohorts: ResearchBehaviorSnapshot["cohorts"];
}) {
  const redeployed = cohorts.redeployAndHold + cohorts.redeployAndExit;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="border-b border-gray-100 dark:border-gray-800 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">What sellers did next</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {cohorts.sellerAddresses} unique minter addresses made a sale. Each appears once below.
            </p>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-right">
            <strong className="text-gray-900 dark:text-gray-100">{redeployed}</strong> minted again ·{" "}
            <strong className="text-gray-900 dark:text-gray-100">{compact(fromSats(cohorts.redeployedPaid))} XCP</strong> redeployed
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(7.5rem,1fr)_1fr_1fr] text-sm">
        <div className="border-b border-r border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3" />
        <div className="border-b border-r border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">
          Still holds
        </div>
        <div className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 p-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400">
          No meaningful balance
        </div>

        <MatrixLabel label="Minted again" />
        <MatrixValue value={cohorts.redeployAndHold} />
        <MatrixValue value={cohorts.redeployAndExit} />

        <MatrixLabel label="Did not mint again" last />
        <MatrixValue value={cohorts.holdWithoutRedeploy} last />
        <MatrixValue value={cohorts.exitWithoutRedeploy} last lastColumn />
      </div>
    </section>
  );
}

function MatrixLabel({ label, last = false }: { label: string; last?: boolean }) {
  return (
    <div className={`${last ? "" : "border-b"} border-r border-gray-100 dark:border-gray-800 p-3 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:p-4`}>
      {label}
    </div>
  );
}

function MatrixValue({
  value,
  last = false,
  lastColumn = false,
}: {
  value: number;
  last?: boolean;
  lastColumn?: boolean;
}) {
  return (
    <div
      className={`${last ? "" : "border-b"} ${lastColumn ? "" : "border-r"} border-gray-100 dark:border-gray-800 p-3 text-center sm:p-4`}
    >
      <strong className="text-xl tabular-nums text-gray-900 dark:text-gray-100">{value}</strong>
      <div className="text-[11px] text-gray-400 dark:text-gray-500">addresses</div>
    </div>
  );
}

function PendingSellTape({ rows }: { rows: [string, PendingPressure][] }) {
  const transactions = rows.reduce((sum, [, row]) => sum + row.sellTransactions, 0);
  const wallets = rows.reduce((sum, [, row]) => sum + row.sellWallets, 0);

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
        No sells waiting in the mempool.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-red-950 dark:text-red-200">Dumping now</h2>
        <span className="text-xs font-semibold text-red-700 dark:text-red-400">
          {transactions} pending {transactions === 1 ? "transaction" : "transactions"} · {wallets} {wallets === 1 ? "wallet" : "wallets"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {rows.map(([asset, row]) => (
          <Link
            key={asset}
            href={`/${asset}`}
            className="rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 px-3 py-2 text-xs hover:border-red-400 dark:hover:border-red-500"
          >
            <strong className="text-gray-900 dark:text-gray-100">{asset}</strong>
            <span className="ml-2 font-semibold text-red-700 dark:text-red-400">{compact(fromSats(row.sellQuantity))} tokens</span>
            <span className="ml-1 text-gray-500 dark:text-gray-400">· {row.sellWallets} wallets · {row.sellTransactions} txs</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function LaunchTable({
  mode,
  title,
  subtitle,
  rows,
  pending,
}: {
  mode: "graduated" | "minting";
  title: string;
  subtitle: string;
  rows: ResearchLaunchBehavior[];
  pending: Map<string, PendingPressure>;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, 5);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 dark:border-gray-800 px-4 py-3 sm:px-5">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">{subtitle}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">No launches in this phase.</p>
      ) : (
        <>
          <div className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden">
            {visibleRows.map((row, index) => (
              <LaunchCard
                key={row.asset}
                mode={mode}
                row={row}
                rank={index + 1}
                pending={pending.get(row.asset) ?? EMPTY_PENDING}
              />
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500">
                {mode === "minting" ? (
                  <tr>
                    <th className="px-5 py-2 font-medium">Launch</th>
                    <th className="px-3 py-2 font-medium">Minters</th>
                    <th className="px-3 py-2 font-medium">Dumpers</th>
                    <th className="px-5 py-2 font-medium">Repeat dumpers</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-5 py-2 font-medium">Launch</th>
                    <th className="px-3 py-2 font-medium">Minter outcomes</th>
                    <th className="px-3 py-2 font-medium">Seller inventory</th>
                    <th className="px-5 py-2 font-medium">New buyers</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleRows.map((row, index) => (
                  <LaunchRow
                    key={row.asset}
                    mode={mode}
                    row={row}
                    rank={index + 1}
                    pending={pending.get(row.asset) ?? EMPTY_PENDING}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="w-full border-t border-gray-100 dark:border-gray-800 px-4 py-2.5 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40"
            >
              {showAll ? "Show top 5" : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function LaunchRow({
  mode,
  row,
  rank,
  pending,
}: {
  mode: "graduated" | "minting";
  row: ResearchLaunchBehavior;
  rank: number;
  pending: PendingPressure;
}) {
  const behavior = row.behavior;

  return (
    <tr className={pending.sellTransactions > 0 ? "bg-red-50/40 dark:bg-red-950/40" : ""}>
      <td className="px-5 py-3 align-top">
        <LaunchName row={row} rank={rank} pending={pending} />
      </td>
      {mode === "minting" ? (
        <>
          <td className="px-3 py-3 align-top">
            <strong className="tabular-nums">{behavior.trackedMinters}</strong>
            <div className="text-xs text-gray-400 dark:text-gray-500">unique addresses</div>
          </td>
          <td className="px-3 py-3 align-top">
            <Allocation count={behavior.knownFastMinters} quantity={behavior.knownFastInventory} total={row.earnedQuantity} />
          </td>
          <td className="px-5 py-3 align-top">
            <Allocation count={behavior.repeatDumpMinters} quantity={behavior.repeatDumpInventory} total={row.earnedQuantity} />
          </td>
        </>
      ) : (
        <>
          <td className="px-3 py-3 align-top">
            <OutcomeLine row={row} />
          </td>
          <td className="px-3 py-3 align-top">
            <Inventory row={row} />
          </td>
          <td className="px-5 py-3 align-top">
            <strong className="tabular-nums">{behavior.buyerOnly}</strong>
            <div className="text-xs text-gray-400 dark:text-gray-500">bought without minting</div>
          </td>
        </>
      )}
    </tr>
  );
}

function LaunchCard({
  mode,
  row,
  rank,
  pending,
}: {
  mode: "graduated" | "minting";
  row: ResearchLaunchBehavior;
  rank: number;
  pending: PendingPressure;
}) {
  const behavior = row.behavior;

  return (
    <article className={pending.sellTransactions > 0 ? "bg-red-50/40 dark:bg-red-950/40 p-4" : "p-4"}>
      <LaunchName row={row} rank={rank} pending={pending} />
      {mode === "minting" ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MobileStat label="Minters" value={String(behavior.trackedMinters)} detail="unique addresses" />
          <MobileStat
            label="Dumpers"
            value={allocationShare(behavior.knownFastInventory, row.earnedQuantity)}
            detail={`${behavior.knownFastMinters} addresses`}
          />
          <MobileStat
            label="Repeat dumpers"
            value={allocationShare(behavior.repeatDumpInventory, row.earnedQuantity)}
            detail={`${behavior.repeatDumpMinters} addresses`}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Minter outcomes</div>
            <OutcomeLine row={row} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
              <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">Seller inventory</div>
              <Inventory row={row} />
            </div>
            <MobileStat label="New buyers" value={String(behavior.buyerOnly)} detail="bought without minting" />
          </div>
        </div>
      )}
    </article>
  );
}

function LaunchName({
  row,
  rank,
  pending,
}: {
  row: ResearchLaunchBehavior;
  rank: number;
  pending: PendingPressure;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs tabular-nums text-gray-400 dark:text-gray-500">#{rank}</span>
        <Link href={`/${row.asset}`} className="font-bold text-purple-600 dark:text-purple-400 hover:underline">
          {row.asset}
        </Link>
      </div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{rankSignal(row)}</div>
      {pending.sellTransactions > 0 && (
        <div className="mt-1 text-xs font-semibold text-red-700 dark:text-red-400">
          {pending.sellTransactions} pending sells · {pending.sellWallets} wallets · {compact(fromSats(pending.sellQuantity))} tokens
        </div>
      )}
    </div>
  );
}

function Allocation({ count, quantity, total }: { count: number; quantity: string; total: string | null }) {
  return (
    <div>
      <strong className="tabular-nums text-red-600 dark:text-red-400">{allocationShare(quantity, total)}</strong>
      <div className="text-xs text-gray-500 dark:text-gray-400">{count} unique addresses</div>
      <div className="text-xs text-gray-400 dark:text-gray-500">{compact(fromSats(quantity))} tokens</div>
    </div>
  );
}

function OutcomeLine({ row }: { row: ResearchLaunchBehavior }) {
  const behavior = row.behavior;
  const sold = Math.max(0, behavior.trackedMinters - behavior.heldWithoutSale - behavior.movedWithoutSale);

  return (
    <div className="text-xs leading-relaxed">
      <strong className="text-green-700 dark:text-green-400">{behavior.heldWithoutSale} held</strong>
      <span className="text-gray-300 dark:text-gray-600"> · </span>
      <strong className="text-amber-700 dark:text-amber-400">{behavior.movedWithoutSale} moved</strong>
      <span className="text-gray-300 dark:text-gray-600"> · </span>
      <strong className="text-red-600 dark:text-red-400">{sold} sold</strong>
      <div className="text-gray-400 dark:text-gray-500">{behavior.trackedMinters} unique minters · exclusive outcomes</div>
    </div>
  );
}

function Inventory({ row }: { row: ResearchLaunchBehavior }) {
  const behavior = row.behavior;
  if (big(behavior.sellerBalance) <= 0n) {
    return <div className="mt-1 text-xs font-semibold text-green-700 dark:text-green-400">Seller inventory cleared</div>;
  }

  return (
    <div className="mt-1 text-xs leading-relaxed">
      <strong className="text-amber-700 dark:text-amber-400">{allocationShare(behavior.sellerBalance, row.hardCap)} of supply</strong>
      <div className="text-gray-500 dark:text-gray-400">held by {behavior.sellersHolding} sellers</div>
      {big(behavior.dumperBalance) > 0n && (
        <div className="text-gray-400 dark:text-gray-500">{allocationShare(behavior.dumperBalance, row.hardCap)} held by dumpers</div>
      )}
      {behavior.dispenserSellers > 0 && (
        <div className="text-gray-400 dark:text-gray-500">{behavior.dispenserSellers} also used a dispenser</div>
      )}
    </div>
  );
}

function MobileStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3">
      <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">{label}</div>
      <div className="mt-1 font-bold tabular-nums text-gray-900 dark:text-gray-100">{value}</div>
      <div className="text-[11px] text-gray-400 dark:text-gray-500">{detail}</div>
    </div>
  );
}

function rankSignal(row: ResearchLaunchBehavior): string {
  if (row.phase === "minting") {
    return `${Math.min(100, ratio(row.earnedQuantity, row.softCap) * 100).toFixed(1)}% minted`;
  }
  const tokenReserve = big(row.poolTokenReserve);
  if (tokenReserve <= 0n) return "—";
  const marketCapRaw =
    (circulatingSupplyRaw(row.hardCap, row.burnedQuantity) * big(row.poolXcpReserve)) /
    tokenReserve;
  return `${compact(fromSats(marketCapRaw))} XCP market cap`;
}

function allocationShare(part: string, whole: string | null): string {
  if (big(whole) <= 0n) return "0.0%";
  return `${Math.min(100, ratio(part, whole) * 100).toFixed(1)}%`;
}
