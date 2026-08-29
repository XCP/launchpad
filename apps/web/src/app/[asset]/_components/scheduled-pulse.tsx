"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import useSWR from "swr";
import { fetchJson } from "@/lib/client";
import {
  blocksEta,
  commas,
} from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

import { LABEL } from "@/components/ui/tokens";
import { blockAge } from "@/lib/chain-time";

/** Chain height, polled lazily: every 2 minutes far out, tightening to 30s
 *  inside the final 12 blocks so the last stretch reads like a countdown. */
function useChainHeight(startBlock: number, initialHeight: number) {
  const { data } = useSWR(
    "cp-height",
    () =>
      fetchJson(`${COUNTERPARTY_API_BASE}/`).then(
        (d: { result: { counterparty_height: number } }) =>
          d.result.counterparty_height,
      ),
    {
      // Blocks land every ~10 minutes; poll like it. Half-minute polling
      // only earns its keep in the last few blocks — a dozen blocks out it
      // was two hours of 30-second requests to learn nothing.
      refreshInterval: (latest) =>
        startBlock - (latest ?? initialHeight) <= 3 ? 30_000 : 180_000,
      revalidateOnFocus: true,
      fallbackData: initialHeight,
    },
  );
  return data ?? initialHeight;
}

/**
 * The scheduled page's living center: countdown and block train.
 *
 * The train reads left to right in chain order — newest mined block, the
 * blocks still to come, then the block that opens minting — so the wait is
 * a place on the chain rather than an abstract bar. The tab title ticks
 * with the count, so a pinned tab is itself a countdown.
 */
export function ScheduledPulse({
  asset,
  startBlock,
  deadlineBlock,
  initialHeight,
  mintForm,
  waitingCta,
}: {
  asset: string;
  startBlock: number;
  deadlineBlock: number;
  initialHeight: number;
  /** Shown in the countdown's place once minting is effectively open. */
  mintForm?: ReactNode;
  /** The "get XCP first" nudge — rendered ONLY while this is still a
   *  countdown. It used to sit outside this component, so the moment the
   *  form appeared the card carried two full-width primary buttons: "Mint
   *  10,000 GENXSIXNINE" directly above "Get XCP before it opens", one of
   *  them urging preparation for a thing the other was already doing. A
   *  screen gets one primary action, and once the form is live that action
   *  is minting. */
  waitingCta?: ReactNode;
}) {
  const height = useChainHeight(startBlock, initialHeight);
  const remaining = Math.max(startBlock - height, 0);
  // `height` is Counterparty's parsed height, not Bitcoin's tip, so this is
  // true exactly when the opening block has been parsed — which is also
  // when the fairminter's own status flips to open.
  const open = remaining <= 0;
  // This used to open the form a block early, reasoning that a transaction
  // broadcast at start_block − 1 can only confirm at start_block anyway. The
  // reasoning holds for consensus and fails at compose: Counterparty refuses
  // to build the mint at all while the fairminter is pending, answering
  // `fairminter is not open for asset: GENXSIXNINE`. A button that can only
  // return an error is worse than no button, so the form waits for open.
  const mintable = open;
  const router = useRouter();
  useEffect(() => {
    if (!mintable) return;
    // Counterparty has to parse the block before the record flips to open,
    // so ask again until the server agrees and this view is replaced.
    const id = setInterval(() => router.refresh(), 20_000);
    router.refresh();
    return () => clearInterval(id);
  }, [mintable, router]);

  useEffect(() => {
    const previous = document.title;
    document.title = open
      ? `LIVE · ${asset}`
      : `${remaining} block${remaining === 1 ? "" : "s"} · ${asset}`;
    // Without this a soft navigation carries the countdown to the next page.
    return () => {
      document.title = previous;
    };
  }, [remaining, open, asset]);


  // Heartbeat: the last Bitcoin block's age, so the page visibly breathes
  // between counterparty polls.
  const { data: recent } = useSWR(
    "btc-recent-blocks",
    () =>
      fetchJson("https://mempool.space/api/v1/blocks") as Promise<
        { height: number; timestamp: number }[]
      >,
    { refreshInterval: 120_000 },
  );
  const tip = recent?.[0] ?? null;
  // Left of the divider: blocks that exist, newest against the line.
  // Right of it: the next blocks, forecast forward — and once the wait is
  // short enough, the opening block itself lands among them.
  // Render more tiles than most screens can show and let each half clip its
  // far end — the row fills whatever width it's given instead of guessing.
  const RUN = 8;
  // Counterparty parses a block or two behind Bitcoin's tip; take whichever
  // is further along so the forecast never re-lists a block that exists.
  const tipHeight = Math.max(tip?.height ?? 0, height);
  // A blocked mempool.space would otherwise leave the mined half empty next
  // to a full forecast, which reads as broken rather than loading.
  const mined =
    recent ??
    Array.from({ length: RUN }, (_, i) => ({
      height: tipHeight - i,
      timestamp: null as number | null,
    }));
  // Nearest first: the next block sits against the divider, the forecast
  // runs away to the left.
  const upcoming = Array.from({ length: RUN }, (_, i) => tipHeight + 1 + i);
  // Minutes, not blocksEta: three tiles in a row reading "~1h" said less
  // than nothing.
  const pendingEta = (blocks: number) =>
    blocks * 10 < 60 ? `~${blocks * 10}m` : `~${((blocks * 10) / 60).toFixed(1)}h`;

  const [nowSec, setNowSec] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowSec(Date.now() / 1000);
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  if (mintable && mintForm) {
    return (
      <div className="mt-6">
        {/* The status pill above is rendered from the server's phase, which
            lags until Counterparty's record flips and the refresh below
            lands — so for a few seconds this label sits under a pill that
            still says "Scheduled". "live" is the honest word for that gap:
            the chain has opened minting, the page hasn't caught up yet. */}
        <div className={`mb-3 text-center ${LABEL}`}>minting is live</div>
        {mintForm}
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="py-2 text-center">
        <div className={`mb-2.5 ${LABEL}`}>
          {open ? "now minting" : "upcoming launch"}
        </div>
        <div className="text-5xl font-extrabold leading-none tracking-tight text-gray-900 dark:text-gray-100 tabular-nums">
          {open ? (
            "open"
          ) : remaining <= 12 ? (
            <>
              {remaining}{" "}
              <span className="text-lg font-semibold text-gray-400 dark:text-gray-500">
                block{remaining === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <>
              {blocksEta(remaining)}{" "}
              <span className="text-lg font-semibold text-gray-400 dark:text-gray-500">
                · {commas(remaining)} blocks
              </span>
            </>
          )}
        </div>
        <div className="mt-2.5 text-sm text-gray-500 dark:text-gray-400 tabular-nums">
          {open
            ? "minting is live — refresh the page"
            : remaining <= 12
              ? `${blocksEta(remaining)} until minting opens`
              : "until minting opens"}
        </div>
      </div>

      {/* Mempool's arrangement: blocks still to come on the left, the chain
          as it stands on the right, newest against the divider so each new
          block lands in the same place. Both halves overflow their edge, so
          a wider screen simply shows more chain. */}
      <div className="mt-8 grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-3">
        {/* The mask makes a clipped tile read as continuation. Without it a
            half-cut height like "61,690" looks like a real block number. */}
        <div className="flex flex-row-reverse justify-start gap-2 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_3rem)]">
          {upcoming.map((h, i) => (
            <BlockTile
              key={h}
              height={h}
              tone={h === startBlock ? "target" : "pending"}
              label={h === startBlock ? "opens" : pendingEta(i + 1)}
              pulseDelayMs={h === startBlock ? undefined : i * 200}
            />
          ))}
        </div>

        <div className="h-16 w-px self-center bg-[repeating-linear-gradient(to_bottom,#e5e7eb_0_4px,transparent_4px_8px)] sm:h-20" />

        <div className="flex justify-start gap-2 overflow-hidden [mask-image:linear-gradient(to_left,transparent,black_3rem)]">
          {mined.map((b, i) => (
            <BlockTile
              key={b.height}
              height={b.height}
              tone={i === 0 ? "tip" : "mined"}
              label={
                nowSec === null || b.timestamp === null
                  ? "\u00b7"
                  : blockAge(nowSec - b.timestamp)
              }
            />
          ))}
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-gray-500 dark:text-gray-400 tabular-nums">
        {open ? (
          "minting is live"
        ) : (
          <>
            <span className="whitespace-nowrap">
              minting opens at{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                block {commas(startBlock)}
              </span>
            </span>
            {deadlineBlock > 0 && (
              <span className="whitespace-nowrap">
                {" \u00b7 "}window closes {commas(deadlineBlock)}
              </span>
            )}
          </>
        )}
      </p>
      {waitingCta}
    </div>
  );
}


/** One block in the split. The height labels it above; inside is the human
 *  fact — how long ago it was mined, or how far out it still is. Pending
 *  blocks breathe, staggered, so the forecast reads as not-yet-real. */
function BlockTile({
  height,
  tone,
  label,
  pulseDelayMs,
}: {
  height: number;
  tone: "tip" | "mined" | "pending" | "target";
  label: string;
  pulseDelayMs?: number;
}) {
  const pulses = tone === "pending";
  const face = {
    tip: "bg-gradient-to-br from-purple-600 to-purple-700 text-white shadow-sm",
    mined: "bg-purple-100 dark:bg-purple-900/50 text-purple-500 dark:text-purple-400",
    pending: "border border-dashed border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-400",
    target:
      "bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-sm ring-2 ring-purple-200 dark:ring-purple-800",
  }[tone];
  return (
    <div className="shrink-0 text-center">
      <div
        className={`mb-1 text-[10px] font-semibold tabular-nums ${
          tone === "pending" ? "text-purple-300" : "text-purple-500 dark:text-purple-400"
        }`}
      >
        {height.toLocaleString()}
      </div>
      <div
        style={
          pulses && pulseDelayMs !== undefined
            ? { animationDelay: `${pulseDelayMs}ms` }
            : undefined
        }
        className={`flex size-[3.75rem] items-center justify-center rounded-xl px-1 text-center text-[11px] font-medium leading-tight sm:size-16 ${face} ${
          pulses ? "animate-pulse motion-reduce:animate-none" : ""
        }`}
      >
        {label}
      </div>
    </div>
  );
}

/* ---------- the standard's terms ---------- */

/**
 * The four fixed facts of an XCP-69 launch, in either denomination. The
 * toggle is the point: the same launch reads as chain units to someone who
 * thinks in XCP and as dollars to everyone else, and two of the four cells
 * change meaning with it — supply becomes market cap (at the mint price,
 * the price you'd actually be paying), and the pool's token side becomes
 * liquidity counted from both legs, which are equal by construction.
 */
