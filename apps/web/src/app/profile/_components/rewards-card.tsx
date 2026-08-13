"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetchMinterEarnings } from "@/lib/api/launchpad-api";
import { commas, fromSats } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";
import { MINTS_PER_MINT, mintsEarned } from "@/lib/rewards";

/**
 * What this address has earned from the rewards programme.
 *
 * Reads the SAME aggregate the /rewards leaderboard does, filtered to one
 * address, rather than counting mint rows here — two ways of counting would
 * eventually disagree, and an address seeing one number on its profile and
 * another on the leaderboard is worse than not showing it at all.
 *
 * Renders nothing for an address that has never minted. A profile shouldn't
 * carry an empty scoreboard for someone who isn't in the programme.
 */
export function RewardsCard({ address, isSelf }: { address: string; isSelf: boolean }) {
  const { data } = useSWR(
    ["minter-earnings", address],
    () => fetchMinterEarnings(1, address),
    { revalidateOnFocus: false },
  );

  const row = data?.[0];
  if (!row || row.mints === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={LABEL}>{isSelf ? "You've earned" : "Earned"}</span>
        <Link href="/rewards" className="text-xs text-purple-600 hover:underline">
          Rewards
        </Link>
      </div>

      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 tabular-nums">
          {commas(mintsEarned(row.mints))}
        </span>
        <span className="text-sm font-medium text-gray-500">MINTS</span>
      </div>

      <p className="mt-1.5 text-xs text-gray-500 tabular-nums">
        {commas(row.mints)} mint{row.mints === 1 ? "" : "s"} across{" "}
        {commas(row.launches)} launch{row.launches === 1 ? "" : "es"} ·{" "}
        {commas(fromSats(row.paid))} XCP committed
      </p>
      <p className="mt-1 text-[11px] text-gray-400">
        {commas(MINTS_PER_MINT)} MINTS per mint. Earned to date, not a balance
        — nothing has been paid out yet.
      </p>
    </div>
  );
}
