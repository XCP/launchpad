"use client";

import Link from "next/link";
import type { RewardAccount } from "@/lib/api/launchpad-api";
import { commas, commasRaw } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";
import { MINTS_PER_MINT } from "@/lib/rewards";

/**
 * What this address has earned from the rewards programme.
 *
 * Reads the programme ledger API rather than counting mint rows in the
 * browser. That keeps its first-10,000 cutoff and payout states identical to
 * the leaderboard and the transaction-backed Rewards tab.
 *
 * Renders nothing for an address that has never minted. A profile shouldn't
 * carry an empty scoreboard for someone who isn't in the programme.
 */
export function RewardsCard({
  account,
  isSelf,
  onOpenHistory,
}: {
  account: RewardAccount | null;
  isSelf: boolean;
  onOpenHistory?: () => void;
}) {
  if (!account || account.earnedMints === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={LABEL}>{isSelf ? "Your lifetime earnings" : "Lifetime earned"}</span>
        <div className="flex items-center gap-3 text-xs">
          {onOpenHistory && (
            <button type="button" onClick={onOpenHistory} className="text-purple-600 dark:text-purple-400 hover:underline">
              Payouts
            </button>
          )}
          <Link href="/rewards" className="text-purple-600 dark:text-purple-400 hover:underline">
            Program
          </Link>
        </div>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
          {commasRaw(account.lifetimeEarnedQuantity)}
        </span>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">MINTS</span>
      </div>

      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
        {commas(account.earnedMints)} mint{account.earnedMints === 1 ? "" : "s"} across{" "}
        {commas(account.launches)} launch{account.launches === 1 ? "" : "es"} ·{" "}
        {commasRaw(account.committedXcp)} XCP committed
      </p>
      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        {commas(MINTS_PER_MINT)} MINTS per mint · all-time program total, not
        your wallet balance.
      </p>
    </div>
  );
}
