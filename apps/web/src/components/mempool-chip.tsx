"use client";

import Link from "next/link";
import { useMempool } from "@/hooks/use-mempool";
import { FOCUS } from "@/components/ui/tokens";

/**
 * Ambient, not watched: this sits on every page, so it polls at a third of
 * the rate /mempool does. Both share an SWR key, so opening the page doesn't
 * add a second poll — it just speeds the shared one up.
 */
const REFRESH_MS = 30_000;

/**
 * The chip's own condition, exported so a caller that has to lay out *around*
 * the chip can ask the same question instead of guessing at it — the header
 * has room for exactly one chip on a phone, and needs to know whether this one
 * is claiming it. Same hook, same key, so asking costs no extra poll.
 *
 * Same filtering as /mempool too: the count here and the count there are one
 * number, not two that happen to agree.
 */
export function useMempoolCount() {
  const { fairminters, mints } = useMempool(REFRESH_MS);
  return fairminters.length + mints.length;
}

/**
 * The header's mempool indicator, shown ONLY when something is queued.
 *
 * Deliberately not a banner — that would shout on every page about something
 * that is usually empty and never urgent. And deliberately not a permanent
 * chip reading zero: the mempool is empty most of the time, so a persistent
 * "mempool 0" would be a control that says nothing almost always, training
 * people to stop reading it. Appearing IS the signal; the count is the
 * detail.
 *
 * The count is of transactions this site has an opinion about — conforming
 * launches and their mints — not the Bitcoin mempool, which is tens of
 * thousands of transactions and none of them anyone's business here.
 */
export function MempoolChip({ className = "" }: { className?: string }) {
  const count = useMempoolCount();

  // Nothing queued, or nothing known yet: render nothing at all rather than a
  // placeholder that would pop into a number a moment later.
  if (count === 0) return null;

  return (
    <Link
      href="/mempool"
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:border-amber-300 ${FOCUS} ${className}`}
    >
      <span className="relative flex size-1.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
      </span>
      {/* Same count grammar as the tabs on /mempool — "Mints (3)" — so the
          chip and the page it opens read as one system. */}
      <span>Mempool</span>
      <span className="tabular-nums">({count})</span>
    </Link>
  );
}
