"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLaunchRoom } from "@/app/[lang]/[asset]/_components/launch-room";
import { useChainHeight } from "@/hooks/use-chain-height";
import { LABEL } from "@/components/ui/tokens";
import { blocksEta } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { big, type Raw } from "@/lib/numeric";

/** The mint's block deadline, with an explicitly approximate wall-clock ETA.
 * Confirmed sellouts suppress the clock while the full page catches up. */
export function MintDeadline({
  deadlineBlock,
  initialHeight,
  initialEarned,
  target,
  allOrNothing = false,
}: {
  deadlineBlock: number;
  initialHeight: number;
  initialEarned: Raw;
  target: Raw;
  allOrNothing?: boolean;
}) {
  const t = useT();
  const num = useNumbers();
  const height = useChainHeight(deadlineBlock, initialHeight);
  const { state } = useLaunchRoom();
  const router = useRouter();
  const remaining = Math.max(0, deadlineBlock - height);
  const closing = deadlineBlock > 0 && (
    (height > 0 && remaining === 0) ||
    state?.status === "closed" ||
    (big(target) > 0n && big(state?.earned_quantity ?? initialEarned) >= big(target))
  );

  // An empty mint still needs to follow its refund. The deadline can arrive
  // before the room or the server-rendered fairminter has caught up. Once
  // the room reports closed, LiveProgress's status listener owns refreshes.
  useEffect(() => {
    if (!closing || state?.status === "closed") return;
    router.refresh();
    const interval = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(interval);
  }, [closing, state?.status, router]);

  if (deadlineBlock <= 0) return null;

  return (
    <div role="status">
      <div className={LABEL}>{t("Time remaining")}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
        <span className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {closing
            ? t("Sale closing")
            : height > 0
              ? t("{eta} left", { eta: `~${blocksEta(remaining, t)}` })
              : t("Block {n}", { n: num.commas(deadlineBlock) })}
        </span>
        {!closing && height > 0 && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {remaining === 1
              ? t("{n} block", { n: num.commas(remaining) })
              : t("{n} blocks", { n: num.commas(remaining) })}
          </span>
        )}
      </div>
      {!closing && height > 0 && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("Closes at block {n}, or earlier if sold out.", { n: num.commas(deadlineBlock) })}
          {allOrNothing && <> {t("If it fails, every minter’s XCP is automatically refunded.")}</>}
        </p>
      )}
    </div>
  );
}
