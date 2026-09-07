"use client";

import { LazyLink } from "@/components/lazy-link";
import { FOCUS } from "@/components/ui/tokens";
import { useT } from "@/lib/i18n/client";

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
  const t = useT();
  return (
    <LazyLink
      href="/rewards"
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-2.5 py-1 text-xs font-medium text-green-800 dark:text-green-300 transition-colors hover:border-green-300 dark:hover:border-green-700 ${FOCUS} ${className}`}
    >
      {/* The mempool chip's light, in green: the pair reads as two lamps on
          one dashboard. */}
      <span className="relative flex size-1.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-green-500" />
      </span>
      {/* "XCP Rewards" only where the row can afford the word. Between lg
          and xl the two navs, three chips and the wallet compete for one
          capped row, and the secondary nav is what loses — FAQ and Docs fall
          off the end. The programme is the same either way, so the chip
          gives up its prefix first. Two whole strings rather than a
          conditional prefix: languages put XCP on the other side of the
          word (Награды XCP, XCP リワード) and some drop it entirely. */}
      <span className="xl:hidden">{t("Rewards")}</span>
      <span className="hidden xl:inline">{t("XCP Rewards")}</span>
    </LazyLink>
  );
}
