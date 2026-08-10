"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { Dialog } from "@/components/ui/dialog";
import { HoverCard } from "@/components/ui/hover-card";
import { fetchJson } from "@/lib/client";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";
import { useDenomination, setDenomination } from "@/lib/denomination";
import {
  blocksEta,
  commas,
  commasRaw,
  compact,
  fromSats,
  shortAddress,
  usd,
} from "@/lib/format";
import { METADATA_ORIGIN } from "@/lib/metadata";
import type { Raw } from "@/lib/numeric";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import {
  type Fairminter,
  isXcp69,
  windowIsExact,
  xcp69Params,
  XCP69,
  XCP69_RAISE_SATS,
} from "@/lib/xcp69";

const XCPIO_API = "https://api.xcp.io/v2";
const SATS = 1e8;

/** One token for the site's uppercase micro-label. */
const LABEL =
  "text-[11px] font-medium uppercase tracking-wider text-gray-500";
/** Keyboard users need to see where they are; nothing else provides this. */
const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500";

/** Compact age: 5m, 6h, 3d, 2w, 14mo, 3y. Terse by design — these sit in
 *  chips and beside addresses, where words would crowd the line. */
const timeAgo = (unixSec: number) => {
  const min = (Date.now() / 1000 - unixSec) / 60;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)}m ago`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 14) return `${Math.round(days)}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 730) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
};

const daysSince = (unixSec: number) => (Date.now() / 1000 - unixSec) / 86_400;

const monthYear = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

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
}: {
  asset: string;
  startBlock: number;
  deadlineBlock: number;
  initialHeight: number;
  /** Shown in the countdown's place once minting is effectively open. */
  mintForm?: ReactNode;
}) {
  const height = useChainHeight(startBlock, initialHeight);
  const remaining = Math.max(startBlock - height, 0);
  const open = remaining <= 0;
  // A transaction broadcast while the tip is start_block − 1 can only
  // confirm at start_block or later, which is exactly what consensus
  // requires — so the form opens a block early rather than a block late.
  const mintable = height >= startBlock - 1;
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
        <div className={`mb-3 text-center ${LABEL}`}>minting is open</div>
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
        <div className="text-5xl font-extrabold leading-none tracking-tight text-gray-900 tabular-nums">
          {open ? (
            "open"
          ) : remaining <= 12 ? (
            <>
              {remaining}{" "}
              <span className="text-lg font-semibold text-gray-400">
                block{remaining === 1 ? "" : "s"}
              </span>
            </>
          ) : (
            <>
              {blocksEta(remaining)}{" "}
              <span className="text-lg font-semibold text-gray-400">
                · {commas(remaining)} blocks
              </span>
            </>
          )}
        </div>
        <div className="mt-2.5 text-sm text-gray-500 tabular-nums">
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

      <p className="mt-5 text-center text-xs text-gray-500 tabular-nums">
        {open ? (
          "minting is live"
        ) : (
          <>
            <span className="whitespace-nowrap">
              minting opens at{" "}
              <span className="font-medium text-gray-700">
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
    </div>
  );
}

/** Age of a mined block, mempool-style: minutes, then hours. */
function blockAge(sec: number) {
  const min = Math.floor(sec / 60);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
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
    mined: "bg-purple-100 text-purple-500",
    pending: "border border-dashed border-purple-200 bg-purple-50 text-purple-400",
    target:
      "bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-sm ring-2 ring-purple-200",
  }[tone];
  return (
    <div className="shrink-0 text-center">
      <div
        className={`mb-1 text-[10px] font-semibold tabular-nums ${
          tone === "pending" ? "text-purple-300" : "text-purple-500"
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
export function TermsStrip({ xcpUsd }: { xcpUsd: number | null }) {
  const denom = useDenomination();
  const usdMode = denom === "USD" && !!xcpUsd;
  const rate = xcpUsd ?? 0;

  const priceXcp = XCP69.PRICE / SATS; // 0.01 XCP per lot
  const lot = XCP69.QUANTITY_BY_PRICE / SATS; // 1,000 tokens
  const capXcp = XCP69.MAX_MINT_PER_ADDRESS / XCP69.QUANTITY_BY_PRICE * priceXcp;
  const capTokens = XCP69.MAX_MINT_PER_ADDRESS / SATS;
  const targetXcp = XCP69_RAISE_SATS / SATS;
  const supplyTokens = XCP69.HARD_CAP / SATS;
  const poolTokens = XCP69.POOL_QUANTITY / SATS;
  // Valued at the price the pool opens to — the first price the market
  // actually quotes, which is where the launch's market cap starts.
  const openPriceXcp = targetXcp / poolTokens;
  const mcapXcp = supplyTokens * openPriceXcp;
  // A pool is worth both its legs, and the launch funds them equally.
  const liquidityXcp = targetXcp * 2;

  const cells: [string, string][] = usdMode
    ? [
        ["Price", `${usd(priceXcp * rate)} / ${commas(lot)}`],
        ["Per address", `${usd(capXcp * rate)} · ${compact(capTokens)} max`],
        ["Target", `${usd(targetXcp * rate)} or refund`],
        [
          "Market cap",
          `${usd(mcapXcp * rate)} · ${usd(liquidityXcp * rate)} pool`,
        ],
      ]
    : [
        ["Price", `${priceXcp} XCP / ${commas(lot)}`],
        ["Per address", `${capXcp} XCP · ${compact(capTokens)} max`],
        ["Target", `${commas(targetXcp)} XCP or refund`],
        ["Supply", `${compact(supplyTokens)} · ${compact(poolTokens)} pool`],
      ];

  return (
    <div className="mt-5 border-y border-gray-100 py-4">
      {/* Four columns only once the card is wide enough for them: at the sm
          breakpoint the card is still 640px and the last value wraps. */}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cells.map(([label, value], i) => (
          <div key={label}>
            <div className="flex items-start justify-between gap-2">
              <dt className={LABEL}>{label}</dt>
              {/* The toggle rides the last label, not the values — a value
                  that wraps to two lines would otherwise drag it out of
                  line with the row. */}
              {/* Two columns on a phone, four above it — so the toggle
                  belongs to a different cell at each width to stay on the
                  end of the first row. */}
              {xcpUsd !== null && (i === 1 || i === cells.length - 1) && (
                <button
                  type="button"
                  onClick={() => setDenomination(usdMode ? "XCP" : "USD")}
                  aria-label={`Show amounts in ${usdMode ? "XCP" : "US dollars"}`}
                  className={`relative shrink-0 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-wide text-gray-500 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:border-purple-400 hover:text-purple-600 active:scale-95 ${FOCUS} ${
                    i === 1 ? "md:hidden" : "hidden md:block"
                  }`}
                >
                  {usdMode ? "XCP" : "USD"}
                </button>
              )}
            </div>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------- hosted metadata (site-issued launches) ---------- */

interface HostedMeta {
  description?: unknown;
  social?: { type?: string; data?: string }[];
}

/** True only for metadata we publish ourselves. Third-party JSON is never
 *  fetched from the visitor's browser: the description URL is chosen by the
 *  issuer, so fetching it would hand every viewer's IP to whoever they
 *  pointed it at. Those launches show the link instead. */
export function isOurMetadata(url: string | null | undefined) {
  return typeof url === "string" && url.startsWith(`${METADATA_ORIGIN}/`);
}

function useHostedMeta(url: string) {
  return useSWR<HostedMeta | null>(
    isOurMetadata(url) ? url : null,
    (u: string) => fetchJson(u).catch(() => null),
    { revalidateOnFocus: false },
  );
}

/**
 * The creator's words, marked as theirs: a blockquote rule instead of site
 * copy, clamped to three lines so a rambling description can never push the
 * countdown below the fold.
 */
export function LaunchDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);
  return (
    <blockquote className="mt-5 border-l-[3px] border-purple-100 pl-4">
      <p
        ref={ref}
        className={`text-sm leading-relaxed text-gray-600 ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`mt-1.5 rounded text-xs font-medium text-purple-600 hover:text-purple-500 ${FOCUS}`}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </blockquote>
  );
}

/** Description for launches whose on-chain description is our hosted
 *  metadata JSON — fetch it and show the human words inside. */
export function HostedDescription({ url }: { url: string }) {
  const { data } = useHostedMeta(url);
  const text =
    data && typeof data.description === "string" && data.description.trim()
      ? data.description.trim()
      : null;
  if (!text) return null;
  return <LaunchDescription text={text} />;
}

const SOCIAL_ICONS: Record<string, { label: string; path: string }> = {
  twitter: {
    label: "X",
    path: "M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.4Z",
  },
  telegram: {
    label: "Telegram",
    path: "M11.94 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.9 6.8-1.64 7.76c-.12.55-.45.68-.9.42l-2.5-1.85-1.21 1.17c-.13.13-.25.25-.5.25l.18-2.55 4.63-4.19c.2-.18-.05-.28-.31-.1l-5.73 3.6-2.47-.77c-.54-.17-.55-.54.11-.8l9.65-3.72c.45-.16.84.11.69.78Z",
  },
};

/** The launch's social links, from the hosted JSON's `social` array. */
export function HostedSocials({ url, asset }: { url: string; asset: string }) {
  const { data } = useHostedMeta(url);
  const seen = new Set<string>();
  const links = (Array.isArray(data?.social) ? data.social : []).filter(
    (s): s is { type: string; data: string } => {
      // `in` walks the prototype chain, so "constructor" would pass; and an
      // href is only safe once its scheme is known.
      if (typeof s?.type !== "string" || !Object.hasOwn(SOCIAL_ICONS, s.type))
        return false;
      if (typeof s?.data !== "string" || !/^https:\/\//i.test(s.data)) return false;
      if (seen.has(s.type)) return false;
      seen.add(s.type);
      return true;
    },
  );
  if (links.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {links.map((s) => (
        <a
          key={s.type}
          href={s.data}
          target="_blank"
          rel="noreferrer"
          aria-label={`${asset} on ${SOCIAL_ICONS[s.type]!.label}`}
          className={`relative flex size-[26px] items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-500 transition-colors after:absolute after:-inset-2 after:content-[''] hover:border-purple-300 hover:bg-white hover:text-purple-600 ${FOCUS}`}
        >
          <svg viewBox="0 0 24 24" className="size-[13px] fill-current">
            <path d={SOCIAL_ICONS[s.type]!.path} />
          </svg>
        </a>
      ))}
    </div>
  );
}

/* ---------- issuer reputation ---------- */

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;

/**
 * A few facts about the issuing address: how many launches before this one,
 * and how the XCP-69 ones ended (pool row = graduated, none = refunded).
 * Fetched lazily so the poster paints first; renders nothing while loading
 * or for a first-time issuer beyond the "first launch" chip.
 */

/** ~90 days, in blocks — the same "new address" threshold IssuerChips uses,
 *  applied here from block height instead of a second block-time lookup
 *  per address (halving the request count for no real loss of precision). */
const NEW_ADDRESS_BLOCKS = 90 * 24 * 6;

/**
 * Which of a sale's minters are freshly-created wallets — a batch of
 * addresses with no history before this launch is the sybil pattern the
 * per-address cap can't catch on its own. Capped to the `addresses` the
 * caller passes in (the biggest minters, in practice) and fetched lazily,
 * client-side, once per mount: this is the same shape as the issuer hover
 * card, not a repeat of the SSR fan-out the index page used to do. Callers
 * sharing the same address list hit the same SWR cache entry — no repeat
 * fetch just because two components on the page both want it.
 */
export function useAddressFreshness(addresses: string[], blockHeight: number) {
  const capped = addresses.slice(0, 25);
  return useSWR(
    capped.length > 0 ? ["new-minters", capped.join(",")] : null,
    async () => {
      const summaries = await Promise.all(
        capped.map((addr) =>
          fetchJson(`${XCPIO_API}/addresses/${addr}/summary`)
            .then((d: { result: AddressSummary | null }) => d.result)
            .catch(() => undefined),
        ),
      );
      // A failed lookup is not evidence of anything — only a real
      // first_block, young enough, counts. (An address the explorer has
      // literally never seen would report first_block: null, which is
      // arguably the newest an address can be; that still counts as new.)
      const isNew = (s: AddressSummary | null) =>
        !s?.first_block || blockHeight - s.first_block < NEW_ADDRESS_BLOCKS;
      const newAddresses = new Set<string>();
      let known = 0;
      capped.forEach((addr, i) => {
        const s = summaries[i];
        if (s === undefined) return;
        known++;
        if (isNew(s)) newAddresses.add(addr);
      });
      return { newAddresses, known };
    },
    { revalidateOnFocus: false },
  ).data;
}

/**
 * Participants, with the freshly-created-wallet count folded in as a
 * sub-fact rather than its own grid cell.
 */
export function ParticipantsStat({
  participants,
  addresses,
  blockHeight,
}: {
  participants: number;
  addresses: string[];
  blockHeight: number;
}) {
  const data = useAddressFreshness(addresses, blockHeight);
  return (
    <div>
      <div className={LABEL}>Minters</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
        {participants}
        {data && data.known > 0 ? ` · ${data.newAddresses.size} new` : ""}
      </div>
    </div>
  );
}

/** Raised, in whichever denomination the site-wide toggle is set to — one
 *  value shown at a time, not XCP-and-USD side by side. */
export function RaisedStat({
  paidQuantity,
  xcpUsd,
  progress,
}: {
  paidQuantity: Raw | null;
  xcpUsd: number | null;
  /** Sale progress in [0, 1] — a share of the raise, not of the wallet. */
  progress: number;
}) {
  const denom = useDenomination();
  const usdMode = denom === "USD" && xcpUsd !== null;
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className={LABEL}>Raised</div>
        {xcpUsd !== null && (
          <button
            type="button"
            onClick={() => setDenomination(usdMode ? "XCP" : "USD")}
            aria-label={`Show amounts in ${usdMode ? "XCP" : "US dollars"}`}
            className={`relative shrink-0 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-wide text-gray-500 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:border-purple-400 hover:text-purple-600 active:scale-95 ${FOCUS}`}
          >
            {usdMode ? "XCP" : "USD"}
          </button>
        )}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">
        {usdMode
          ? usd(fromSats(paidQuantity) * (xcpUsd as number))
          : `${commasRaw(paidQuantity)} XCP`}
        {" · "}
        {(progress * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%
      </div>
    </div>
  );
}

export function IssuerChips({
  source,
  currentAsset,
  trailing,
}: {
  source: string;
  currentAsset: string;
  /** The project's own links, flowing at the end of the same run. */
  trailing?: ReactNode;
}) {
  // First-timers get a different second chip: what they've issued outside
  // the standard says whether they're new on-chain or just new here.
  const { data } = useSWR(
    ["issuer-history", source, currentAsset],
    async () => {
      const d = (await fetchJson(
        `${COUNTERPARTY_API_BASE}/addresses/${source}/fairminters?limit=100&verbose=true`,
      )) as { result: (Fairminter & { block_time?: number })[] };
      // Only launches held to this standard count, so "2nd launch" means the
      // second XCP-69 one. Parameters are readable from the row; the timing
      // clauses need each launch's creation event, because a row that has
      // opened no longer reports the block it was announced in.
      const shaped = (d.result ?? [])
        .filter((r) => r.asset !== currentAsset && xcp69Params(r))
        .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0))
        .slice(0, 8);
      const verdicts = await Promise.all(
        shaped.map(async (r) => {
          if (r.status === "pending")
            return isXcp69(r, undefined) ? r : null;
          const event = (await fetchJson(
            `${COUNTERPARTY_API_BASE}/transactions/${r.tx_hash}/events/NEW_FAIRMINTER`,
          ).catch(() => null)) as {
            result?: {
              block_index: number;
              params: { soft_cap_deadline_block: number };
            }[];
          } | null;
          const created = event?.result?.[0];
          if (!created) return null;
          const conforms =
            isXcp69(r, created.block_index) &&
            (r.status !== "closed" ||
              windowIsExact(r, created.params.soft_cap_deadline_block));
          return conforms ? r : null;
        }),
      );
      const prior = verdicts.filter(
        (r): r is (typeof shaped)[number] => r !== null,
      );
      const closed = prior.filter((r) => r.status === "closed");
      // Pool existence is the launched-vs-refunded oracle; one call each,
      // so judge only the four most recent.
      // Three-state on purpose: a timeout or a 500 must not read as "no
      // pool", which the chip would publish as someone's launch refunding.
      const pools = await Promise.all(
        closed.slice(0, 4).map((r) =>
          fetchJson(
            `${COUNTERPARTY_API_BASE}/pools/${encodeURIComponent(r.asset)}/XCP`,
          )
            .then((p: { result: unknown }) => (p.result ? "graduated" : "refunded"))
            .catch(() => "unknown"),
        ),
      );
      const judged = pools.filter((p) => p !== "unknown");
      const last = prior[0];
      return {
        prior: prior.length,
        priorCapped: (d.result ?? []).length >= 100,
        judged: judged.length,
        graduated: judged.filter((p) => p === "graduated").length,
        last: last?.block_time
          ? { asset: last.asset, at: last.block_time }
          : null,
      };
    },
    { revalidateOnFocus: false },
  );
  const firstTimer = data?.prior === 0;
  const issued = useIssuedCount(firstTimer ? source : null);
  const summary = useAddressSummary(firstTimer ? source : null);
  const firstSeen = useFirstSeen(firstTimer ? summary?.first_block : null);

  // One chip, filled by the first fact that says something. A creator's
  // own history beats their age, and age beats nothing — but "new address"
  // is a real answer, not a fallback, so it's stated rather than omitted.
  const NEW_ADDRESS_DAYS = 90;
  const ageDays = firstSeen ? daysSince(firstSeen) : null;
  const standing =
    issued && issued.count > 0
      ? `${commas(issued.count)}${issued.capped ? "+" : ""} ${
          issued.count === 1 && !issued.capped ? "asset" : "assets"
        } issued`
      : ageDays !== null && ageDays > NEW_ADDRESS_DAYS
        ? `on-chain since ${new Date(firstSeen! * 1000).getFullYear()}`
        : // Only claim "new" on evidence: a failed lookup is not a young address.
          firstSeen !== null && issued !== null
          ? "new address"
          : null;

  if (!data) return trailing ? <div className="mt-2">{trailing}</div> : null;

  const chip =
    "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 tabular-nums";

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
        {data.prior === 0
          ? "first launch"
          : data.priorCapped
            ? `${commas(data.prior)}+ launches`
            : `${ordinal(data.prior + 1)} launch`}
      </span>
      {data.judged > 0 && (
        <span className={chip}>
          {data.graduated} graduated · {data.judged - data.graduated} refunded
        </span>
      )}
      {data.last && (
        <Link
          href={`/${data.last.asset}`}
          className={`${chip} transition-colors hover:border-purple-300 hover:text-purple-600`}
        >
          last launch {timeAgo(data.last.at)} · {data.last.asset}
        </Link>
      )}
      {data.prior === 0 && standing && <span className={chip}>{standing}</span>}
      {trailing}
    </div>
  );
}

/* ---------- issuer identity ---------- */

interface Reputation {
  track_record?: { score?: number; tier?: string };
}

interface AddressSummary {
  xcp?: string | number | null;
  assets?: number | null;
  first_block?: number | null;
  last_block?: number | null;
}

/** The explorer's address summary, shared: the chips read it eagerly and
 *  the hover card reuses the same answer instead of asking again. */
function useAddressSummary(source: string | null) {
  const { data } = useSWR(
    source ? ["address-summary", source] : null,
    () =>
      (fetchJson(`${XCPIO_API}/addresses/${source}/summary`) as Promise<{
        result: AddressSummary | null;
      }>)
        .then((d) => d.result ?? null)
        .catch(() => null),
    { revalidateOnFocus: false },
  );
  return data ?? null;
}

/** When an address first appeared, as a real block timestamp — the model
 *  reports a height, and estimating a date from it drifts by months. */
function useFirstSeen(firstBlock: number | null | undefined) {
  const { data } = useSWR(
    firstBlock ? ["block-time", firstBlock] : null,
    () =>
      (fetchJson(`${COUNTERPARTY_API_BASE}/blocks/${firstBlock}`) as Promise<{
        result: { block_time: number };
      }>)
        .then((d) => d.result.block_time)
        .catch(() => null),
    { revalidateOnFocus: false },
  );
  return data ?? null;
}

/** Assets ever issued from an address — the explorer returns one row per
 *  asset, so a capped page plus its cursor is an exact count or a floor.
 *  Shared through SWR so the chips and the hover card cost one request. */
function useIssuedCount(source: string | null) {
  const { data } = useSWR(
    source ? ["issued-count", source] : null,
    () => issuedCount(source!).catch(() => null),
    { revalidateOnFocus: false },
  );
  return data ?? null;
}

async function issuedCount(source: string) {
  const CAP = 100;
  const d = (await fetchJson(
    `${XCPIO_API}/addresses/${source}/issued?limit=${CAP}`,
  )) as { result: { asset: string }[]; next_offset?: number | null };
  return { count: (d.result ?? []).length, capped: Boolean(d.next_offset) };
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      aria-label="Copy issuer address"
      className={`relative ml-1 inline-flex size-5 items-center justify-center rounded align-[-3px] text-gray-400 transition-colors after:absolute after:-inset-3 after:content-[''] hover:bg-gray-100 hover:text-purple-600 ${FOCUS}`}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="size-3 fill-green-600">
          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-3 fill-current">
          <path d="M16 1H4a2 2 0 0 0-2 2v13h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z" />
        </svg>
      )}
    </button>
  );
}

/**
 * "by 1FairP…pkiGfX" with a copy button, and an at-a-glance card on
 * hover/focus: XCP balance and first-seen date as the headline numbers,
 * tokens held and issued below, track record as a footnote. The link still
 * goes to the explorer, so touch users lose only the preview.
 */
export function IssuerLine({ source }: { source: string }) {
  // The reputation call is worth making only for someone who asks for the
  // card; the summary is already in flight for the chips, so reading it
  // here costs nothing.
  const [armed, setArmed] = useState(false);
  const coarse = useCoarsePointer();
  const summary = useAddressSummary(source);
  const firstSeen = useFirstSeen(summary?.first_block);
  const { data: rep } = useSWR(
    armed ? ["reputation", source] : null,
    () =>
      (fetchJson(`${XCPIO_API}/addresses/${source}/reputation`) as Promise<{
        result: Reputation | null;
      }>)
        .then((d) => d.result ?? null)
        .catch(() => null),
    { revalidateOnFocus: false },
  );

  const xcp = summary?.xcp;
  const xcpNum = xcp === null || xcp === undefined ? null : Number(xcp);
  const held = summary?.assets;
  const issued = useIssuedCount(armed ? source : null);
  const score = rep?.track_record?.score;
  const tier = rep?.track_record?.tier;

  return (
    <span className="mt-1 inline-block text-[13px] text-gray-500 tabular-nums">
      by{" "}
      <HoverCard
        touch={coarse}
        onArm={() => setArmed(true)}
        trigger={
          coarse ? (
            // A tap can't hover, so it opens the card instead of leaving the
            // page; the explorer link lives inside it.
            <button type="button" className={`rounded underline-offset-2 ${FOCUS}`}>
              {shortAddress(source)}
            </button>
          ) : (
            <a
              href={`https://xcp.io/address/${source}`}
              target="_blank"
              rel="noreferrer"
              className={`rounded underline-offset-2 hover:underline ${FOCUS}`}
            >
              {shortAddress(source)}
            </a>
          )
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-gray-50 p-3">
            <div className={LABEL}>XCP balance</div>
            <div className="mt-0.5 text-lg font-bold text-gray-900 tabular-nums">
              {xcpNum === null || Number.isNaN(xcpNum) ? "—" : commas(xcpNum)}
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <div className={LABEL}>First seen</div>
            <div className="mt-0.5 text-lg font-bold text-gray-900 tabular-nums">
              {firstSeen ? monthYear(firstSeen) : "—"}
            </div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Holds{" "}
            <span className="font-semibold text-gray-900 tabular-nums">
              {typeof held === "number" ? commas(held) : "—"}
            </span>{" "}
            {held === 1 ? "token" : "tokens"}
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
            Issued{" "}
            <span className="font-semibold text-gray-900 tabular-nums">
              {issued
                ? `${commas(issued.count)}${issued.capped ? "+" : ""}`
                : "—"}
            </span>{" "}
            {issued?.count === 1 && !issued.capped ? "token" : "tokens"}
          </div>
        </div>
        {typeof score === "number" && tier && (
          <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
            Track record {Math.round(score)}/100 ({tier}) — observed on-chain
            reputation from the XCP.io explorer, not an endorsement.
          </p>
        )}
        <a
          href={`https://xcp.io/address/${source}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-xs font-medium text-purple-600 hover:underline"
        >
          View on explorer ↗
        </a>
      </HoverCard>
      <CopyButton value={source} />
    </span>
  );
}

/* ---------- sharing ---------- */

/**
 * Share sheet: a preview of what a link to this launch looks like when it
 * lands somewhere, then the two things anyone actually wants to do with it.
 * The preview is built from the same art and facts as the page, so what's
 * shown here is what unfurls.
 */
export function ShareButton({
  asset,
  headline,
  subline,
}: {
  asset: string;
  headline: string;
  subline: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `https://xcp.fun/${asset}`;
  const text = `${asset}: ${headline} on xcp.fun`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex h-8 items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 text-[11px] font-medium text-purple-600 transition-colors hover:border-purple-600 hover:bg-purple-600 hover:text-white ${FOCUS}`}
      >
        <svg viewBox="0 0 24 24" className="size-3 fill-current">
          <path d="M18 16.08a2.9 2.9 0 0 0-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.5.47 1.17.77 1.91.77a2.8 2.8 0 1 0-2.8-2.8c0 .24.04.47.09.7L8.11 9.97A2.8 2.8 0 0 0 3.4 12a2.8 2.8 0 0 0 4.71 2.03l7.12 4.16c-.05.21-.08.43-.08.65a2.73 2.73 0 1 0 2.85-2.76Z" />
        </svg>
        Share
      </button>

      <Dialog open={open} onOpenChange={setOpen} title="Share this launch">
        <div className="px-2 pb-2">
          <p className="mb-3 text-xs text-gray-500">
            Copy the link, or post it straight to X.
          </p>

          {/* What the link looks like when it unfurls. */}
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <TokenImage
              asset={asset}
              large
              className="size-16 shrink-0 rounded-xl bg-gray-100 object-cover"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">
                {asset}
              </div>
              <div className="truncate text-xs text-gray-600">{headline}</div>
              <div className="mt-0.5 truncate text-[11px] text-gray-400">
                {subline}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-gray-400">
                xcp.fun/{asset}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(url).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                },
                () => {},
              );
            }}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-600 px-5 py-3.5 font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99] ${FOCUS}`}
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noreferrer"
            className={`mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-5 py-3.5 font-medium text-white transition-all hover:bg-gray-700 active:scale-[0.99] ${FOCUS}`}
          >
            <svg viewBox="0 0 24 24" className="size-3.5 fill-current">
              <path d={SOCIAL_ICONS.twitter!.path} />
            </svg>
            Share on X
          </a>
        </div>
      </Dialog>
    </>
  );
}

/* ---------- launch status + age ---------- */

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  scheduled: {
    label: "Scheduled",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  minting: {
    label: "Minting",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  graduated: {
    label: "Graduated",
    className: "border-purple-200 bg-purple-50 text-purple-700",
  },
  // Amber, not red: the sale missed its target, but nobody lost anything —
  // every participant got their XCP back. Red would overstate the outcome.
  refunded: {
    label: "Refunded",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
};

const MINTED_OUT = {
  label: "Minted out",
  className: "border-gray-200 bg-gray-100 text-gray-600",
};

/** Lifecycle pill beside the asset name - the first thing a visitor needs:
 *  can I act now, is it coming, or is it over? */
export function StatusPill({
  phase,
  hasPool,
}: {
  phase: string;
  hasPool: boolean;
}) {
  // A classic fairminter that sold out has no pool to graduate into; calling
  // that "graduated" would overstate it.
  const style =
    (phase === "graduated" && !hasPool ? null : STATUS_STYLES[phase]) ??
    MINTED_OUT;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      {style.label}
      {/* A sale in progress should look like it's in progress. */}
      {phase === "minting" && (
        <span aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="animate-pulse motion-reduce:animate-none"
              style={{ animationDelay: `${i * 250}ms` }}
            >
              .
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** How long ago the launch itself was announced, linked to the fairminter
 *  transaction. Pairs with the issuer address: who, and when. */
export function AnnouncedAgo({
  blockIndex,
  txHash,
}: {
  blockIndex: number;
  txHash: string;
}) {
  const unconfirmed = blockIndex >= 9_999_999;
  const { data: at } = useSWR(
    unconfirmed ? null : ["block-time", blockIndex],
    () =>
      (fetchJson(`${COUNTERPARTY_API_BASE}/blocks/${blockIndex}`) as Promise<{
        result: { block_time: number };
      }>)
        .then((d) => d.result.block_time)
        .catch(() => null),
    { revalidateOnFocus: false },
  );
  if (!unconfirmed && !at) return null;
  return (
    <a
      href={`https://xcp.io/tx/${txHash}`}
      target="_blank"
      rel="noreferrer"
      className="ml-2 text-[13px] text-gray-400 underline-offset-2 hover:underline"
    >
      {unconfirmed ? "unconfirmed" : timeAgo(at!)}
    </a>
  );
}

/* ---------- artwork ---------- */

/** The poster art: compact in the card, full-size in a dialog on click.
 *  The shared Dialog brings focus trapping, Escape, and scroll lock. */
export function ArtLightbox({ asset }: { asset: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View ${asset} artwork full size`}
        className={`group w-full shrink-0 cursor-zoom-in rounded-2xl sm:w-auto ${FOCUS}`}
      >
        {/* A poster on a phone: full width, then the compact identity square
            once there's a column to sit beside. */}
        <TokenImage
          asset={asset}
          large
          className="aspect-square w-full rounded-2xl bg-gray-100 object-cover shadow-sm transition-transform group-hover:scale-[1.03] sm:size-[5.5rem] sm:aspect-auto sm:w-auto"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={asset}>
        <TokenImage
          asset={asset}
          large
          className="max-h-[70vh] w-full rounded-2xl object-contain"
        />
      </Dialog>
    </>
  );
}
