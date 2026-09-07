"use client";

import type { RewardAccount } from "@/lib/api/launchpad-api";
import { commas, commasRaw, shortAddress } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";

const statusTone = {
  confirmed: "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400",
  broadcast: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400",
} as const;

/** Transaction-backed reward history. The parent only mounts this component
 * after at least one payout has a real tx hash. */
export function RewardsTab({ account }: { account: RewardAccount }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 p-4">
        <span className={LABEL}>Lifetime earned</span>
        <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
          {commasRaw(account.lifetimeEarnedQuantity)}{" "}
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">MINTS</span>
        </p>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        All-time program total, not your current wallet balance.
      </p>

      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className="grid grid-cols-[minmax(0,1fr)_7rem_5rem_7rem] gap-x-4 pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <span>Distribution</span>
            <span className="text-right">Reward</span>
            <span className="text-right">Mints</span>
            <span className="text-right">Transaction</span>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {account.payouts.map((payout) => (
              <li
                key={`${payout.batchId}:${payout.txHash}`}
                className="grid grid-cols-[minmax(0,1fr)_7rem_5rem_7rem] items-center gap-x-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                    Mints {commas(payout.firstMintNumber)}–{commas(payout.cutoffMintNumber)}
                  </p>
                  <p className="truncate text-xs text-gray-400 dark:text-gray-500">{payout.batchId}</p>
                </div>
                <span className="text-right tabular-nums text-gray-900 dark:text-gray-100">
                  {commasRaw(payout.quantity)} MINTS
                </span>
                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                  {commas(payout.mintCount)}
                </span>
                <span className="flex items-center justify-end gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone[payout.status]}`}>
                    {payout.status === "confirmed" ? "Paid" : "Confirming"}
                  </span>
                  <a
                    href={`https://xcp.io/tx/${payout.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    title={payout.txHash}
                    className="font-mono text-xs text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    {shortAddress(payout.txHash)}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
