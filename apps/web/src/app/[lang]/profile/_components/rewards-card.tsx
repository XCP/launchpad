"use client";

import { LazyLink } from "@/components/lazy-link";
import type { RewardAccount } from "@/lib/api/launchpad-api";
import { LABEL } from "@/components/ui/tokens";
import { MINTS_PER_MINT } from "@/lib/rewards";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";

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
  const num = useNumbers();
  const t = useT();
  if (!account || account.earnedMints === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={LABEL}>{isSelf ? t("Your lifetime earnings") : t("Lifetime earned")}</span>
        <div className="flex items-center gap-3 text-xs">
          {onOpenHistory && (
            <button type="button" onClick={onOpenHistory} className="text-purple-600 dark:text-purple-400 hover:underline">
              {t("Payouts")}
            </button>
          )}
          <LazyLink href="/rewards" className="text-purple-600 dark:text-purple-400 hover:underline">
            {t("Program")}
          </LazyLink>
        </div>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
          {num.commasRaw(account.lifetimeEarnedQuantity)}
        </span>
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">MINTS</span>
      </div>

      <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
        {t("{mints} across {launches} · {xcp} XCP committed", {
          mints:
            account.earnedMints === 1
              ? t("{n} mint", { n: num.commas(account.earnedMints) })
              : t("{n} mints", { n: num.commas(account.earnedMints) }),
          launches:
            account.launches === 1
              ? t("{n} launch", { n: num.commas(account.launches) })
              : t("{n} launches", { n: num.commas(account.launches) }),
          xcp: num.commasRaw(account.committedXcp),
        })}
      </p>
      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
        {t("{n} MINTS per mint · all-time program total, not your wallet balance.", { n: num.commas(MINTS_PER_MINT) })}
      </p>
    </div>
  );
}
