import Link from "next/link";
import { FOCUS } from "@/components/ui/tokens";

/**
 * The header's pointer to the rewards programme — the mempool chip's sibling,
 * in the same shape and register so the pair reads as one family of ambient
 * signals: amber for what's queued, green for what's on offer.
 *
 * Unlike its sibling it is always on (for now): the programme is live whether
 * or not anyone is minting this minute, so there is no empty state to hide.
 */
export function RewardsChip({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/rewards"
      title="MINTS for every mint, and an XCP bounty for the first launches to graduate"
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 transition-colors hover:border-green-300 ${FOCUS} ${className}`}
    >
      Rewards
    </Link>
  );
}
