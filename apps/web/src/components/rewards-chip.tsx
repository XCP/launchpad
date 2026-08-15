import Link from "next/link";
import { FOCUS } from "@/components/ui/tokens";

/**
 * The header's pointer to the rewards programme — the mempool chip's sibling,
 * in the same shape and register so the pair reads as one family of ambient
 * signals: amber for what's queued, green for what's on offer.
 *
 * Unlike its sibling it has no empty state of its own: the programme is live
 * whether or not anyone is minting this minute. It can still be withheld from
 * above — the header drops it on narrow screens while mempool is up, where
 * there is room for one chip and queued work is the more urgent of the two.
 */
export function RewardsChip({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/rewards"
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 transition-colors hover:border-green-300 ${FOCUS} ${className}`}
    >
      {/* The mempool chip's light, in green: the pair reads as two lamps on
          one dashboard. */}
      <span className="relative flex size-1.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-green-500" />
      </span>
      <span>XCP Rewards</span>
    </Link>
  );
}
