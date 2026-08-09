"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { Dialog } from "@/components/ui/dialog";
import { HoverCard } from "@/components/ui/hover-card";
import { fetchJson } from "@/lib/client";
import { blocksEta, commas, shortAddress } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { type Fairminter, isXcp69 } from "@/lib/xcp69";

const XCPIO_API = "https://api.xcp.io/v2";

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
      refreshInterval: (latest) =>
        startBlock - (latest ?? initialHeight) <= 12 ? 30_000 : 120_000,
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
}: {
  asset: string;
  startBlock: number;
  deadlineBlock: number;
  initialHeight: number;
}) {
  const height = useChainHeight(startBlock, initialHeight);
  const remaining = Math.max(startBlock - height, 0);
  const open = remaining <= 0;

  useEffect(() => {
    document.title = open ? `LIVE · ${asset}` : `${remaining} blocks · ${asset}`;
  }, [remaining, open, asset]);


  // Heartbeat: the last Bitcoin block's age, so the page visibly breathes
  // between counterparty polls.
  const { data: recent } = useSWR(
    "btc-recent-blocks",
    () =>
      fetchJson("https://mempool.space/api/v1/blocks") as Promise<
        { height: number; timestamp: number }[]
      >,
    { refreshInterval: 60_000 },
  );
  const tip = recent?.[0] ?? null;
  // Left of the divider: blocks that exist, newest against the line.
  // Right of it: the next blocks, forecast forward — and once the wait is
  // short enough, the opening block itself lands among them.
  const mined = [...(recent ?? []).slice(0, 3)].reverse();
  const tipHeight = tip?.height ?? height;
  const upcoming = [1, 2, 3].map((n) => tipHeight + n);

  const [nowSec, setNowSec] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowSec(Date.now() / 1000);
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mt-7">
      <div className="text-center">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-400">
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
                · {remaining.toLocaleString()} blocks
              </span>
            </>
          )}
        </div>
        <div className="mt-2 text-sm text-gray-500 tabular-nums">
          {open
            ? "minting is live — refresh the page"
            : remaining <= 12
              ? `${blocksEta(remaining)} until minting opens · block ${startBlock.toLocaleString()}`
              : `until minting opens · block ${startBlock.toLocaleString()}`}
        </div>
      </div>

      {/* Mempool's split: the chain as it stands on the left, pinned to the
          divider so each new block lands against it, and the blocks still to
          come on the right. The opening block joins the forecast once it's
          close enough to be one of them. */}
      <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-3">
        <div className="flex justify-end gap-2 overflow-hidden">
          {mined.map((b, i) => (
            <BlockTile
              key={b.height}
              height={b.height}
              tone={i === mined.length - 1 ? "tip" : "mined"}
              label={
                nowSec === null ? "\u00b7" : blockAge(nowSec - b.timestamp)
              }
              className={i === 0 ? "hidden sm:block" : undefined}
            />
          ))}
        </div>

        <div className="h-16 w-px self-center bg-[repeating-linear-gradient(to_bottom,#e5e7eb_0_4px,transparent_4px_8px)] sm:h-20" />

        <div className="flex justify-start gap-2 overflow-hidden">
          {upcoming.map((h, i) => (
            <BlockTile
              key={h}
              height={h}
              tone={h === startBlock ? "target" : "pending"}
              label={h === startBlock ? "opens" : blocksEta(i + 1)}
              className={i === 2 ? "hidden sm:block" : undefined}
            />
          ))}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-500 tabular-nums">
        {open ? (
          "minting is live"
        ) : (
          <>
            minting opens at{" "}
            <span className="font-medium text-gray-700">
              block {startBlock.toLocaleString()}
            </span>
            {deadlineBlock > 0 &&
              ` \u00b7 window closes ${deadlineBlock.toLocaleString()}`}
          </>
        )}
      </p>
    </div>
  );
}

/** Age of a mined block, mempool-style: minutes, then hours. */
function blockAge(sec: number) {
  if (sec < 90) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

/** One block in the split. The height labels it above; inside is the human
 *  fact — how long ago it was mined, or how far out it still is. */
function BlockTile({
  height,
  tone,
  label,
  className = "",
}: {
  height: number;
  tone: "tip" | "mined" | "pending" | "target";
  label: string;
  className?: string;
}) {
  const face = {
    tip: "bg-gradient-to-br from-purple-600 to-purple-700 text-white shadow-sm",
    mined: "bg-purple-100 text-purple-500",
    pending: "border border-dashed border-purple-200 bg-purple-50 text-purple-400",
    target:
      "bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-sm ring-2 ring-purple-200",
  }[tone];
  return (
    <div className={`text-center ${className}`}>
      <div
        className={`mb-1 text-[10px] font-semibold tabular-nums ${
          tone === "pending" ? "text-purple-300" : "text-purple-500"
        }`}
      >
        {height.toLocaleString()}
      </div>
      <div
        className={`flex size-[3.75rem] items-center justify-center rounded-xl px-1 text-center text-[11px] font-medium leading-tight sm:size-16 ${face}`}
      >
        {label}
      </div>
    </div>
  );
}

/* ---------- hosted metadata (site-issued launches) ---------- */

interface HostedMeta {
  description?: unknown;
  social?: { type?: string; data?: string }[];
}

function useHostedMeta(url: string) {
  return useSWR(url, (u: string) =>
    fetchJson(u).catch(() => null),
  ) as { data: HostedMeta | null | undefined };
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
          className="mt-1.5 text-xs font-medium text-purple-600 hover:text-purple-500"
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
  const links = (Array.isArray(data?.social) ? data.social : []).filter(
    (s): s is { type: string; data: string } =>
      typeof s?.data === "string" && typeof s?.type === "string" && s.type in SOCIAL_ICONS,
  );
  if (links.length === 0) return null;
  return (
    <div className="flex shrink-0 gap-1.5">
      {links.map((s) => (
        <a
          key={s.type}
          href={s.data}
          target="_blank"
          rel="noreferrer"
          aria-label={`${asset} on ${SOCIAL_ICONS[s.type]!.label}`}
          className="flex size-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:border-purple-300 hover:text-purple-600"
        >
          <svg viewBox="0 0 24 24" className="size-[15px] fill-current">
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
export function IssuerChips({
  source,
  currentAsset,
}: {
  source: string;
  currentAsset: string;
}) {
  const { data } = useSWR(
    ["issuer-history", source, currentAsset],
    async () => {
      const d = (await fetchJson(
        `${COUNTERPARTY_API_BASE}/addresses/${source}/fairminters?limit=100&verbose=true`,
      )) as { result: (Fairminter & { block_time?: number })[] };
      // Only conforming launches count - "2nd launch" has to mean the second
      // one held to this standard, not the second fairminter of any shape.
      const prior = (d.result ?? [])
        .filter((r) => r.asset !== currentAsset && isXcp69(r))
        .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0));
      const closed = prior.filter((r) => r.status === "closed");
      // Pool existence is the launched-vs-refunded oracle; a handful of
      // extra calls, so cap at the 8 most recent.
      const pools = await Promise.all(
        closed.slice(0, 8).map((r) =>
          fetchJson(
            `${COUNTERPARTY_API_BASE}/pools/${encodeURIComponent(r.asset)}/XCP`,
          )
            .then((p: { result: unknown }) => p.result ?? null)
            .catch(() => null),
        ),
      );
      const last = prior[0];
      // First-timers get a different second chip: what they have issued
      // outside the standard says whether they are new on-chain or new here.
      const issued =
        prior.length === 0 ? await issuedCount(source).catch(() => null) : null;
      return {
        prior: prior.length,
        judged: pools.length,
        graduated: pools.filter(Boolean).length,
        last: last?.block_time
          ? { asset: last.asset, at: last.block_time }
          : null,
        issued,
      };
    },
    { revalidateOnFocus: false },
  );
  if (!data) return null;

  const chip =
    "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 tabular-nums";

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
        {data.prior === 0 ? "first launch" : `${ordinal(data.prior + 1)} launch`}
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
      {data.prior === 0 && data.issued && data.issued.count > 0 && (
        <span className={chip}>
          {commas(data.issued.count)}
          {data.issued.capped ? "+" : ""}{" "}
          {data.issued.count === 1 && !data.issued.capped ? "asset" : "assets"}{" "}
          issued
        </span>
      )}
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
}

/** Assets ever issued from an address — the explorer returns one row per
 *  asset, so a capped page plus its cursor is an exact count or a floor. */
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
      className="ml-1 inline-flex size-5 items-center justify-center rounded align-[-3px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-purple-600"
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
  const { data } = useSWR(
    ["issuer-card", source],
    async () => {
      const [summary, rep, issued] = await Promise.all([
        (fetchJson(`${XCPIO_API}/addresses/${source}/summary`) as Promise<{
          result: AddressSummary | null;
        }>)
          .then((d) => d.result ?? null)
          .catch(() => null),
        (fetchJson(`${XCPIO_API}/addresses/${source}/reputation`) as Promise<{
          result: Reputation | null;
        }>)
          .then((d) => d.result ?? null)
          .catch(() => null),
        issuedCount(source).catch(() => null),
      ]);
      // first_block is a height; the block record carries the real time
      // (600s-average estimates drift by months at this scale).
      const firstSeen = summary?.first_block
        ? await (fetchJson(
            `${COUNTERPARTY_API_BASE}/blocks/${summary.first_block}`,
          ) as Promise<{ result: { block_time: number } }>)
            .then((d) => d.result.block_time)
            .catch(() => null)
        : null;
      return { summary, rep, issued, firstSeen };
    },
    { revalidateOnFocus: false },
  );

  const xcp = data?.summary?.xcp;
  const xcpNum = xcp === null || xcp === undefined ? null : Number(xcp);
  const held = data?.summary?.assets;
  const issued = data?.issued;
  const score = data?.rep?.track_record?.score;
  const tier = data?.rep?.track_record?.tier;

  return (
    <span className="mt-1 inline-block text-[13px] text-gray-500 tabular-nums">
      by{" "}
      <HoverCard
        trigger={
          <a
            href={`https://xcp.io/address/${source}`}
            target="_blank"
            rel="noreferrer"
            className="rounded hover:text-purple-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
          >
            {shortAddress(source)}
          </a>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
              XCP balance
            </div>
            <div className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
              {xcpNum === null || Number.isNaN(xcpNum) ? "—" : commas(xcpNum)}
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
              First seen
            </div>
            <div className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
              {data?.firstSeen ? monthYear(data.firstSeen) : "—"}
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
      </HoverCard>
      <CopyButton value={source} />
    </span>
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
      className="ml-2 text-[13px] text-gray-400 hover:text-purple-600 hover:underline"
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
        className="group shrink-0 cursor-zoom-in rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
      >
        <TokenImage
          asset={asset}
          large
          className="size-[5.5rem] rounded-2xl bg-gray-100 object-cover shadow-sm transition-transform group-hover:scale-[1.03]"
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
