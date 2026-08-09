"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { fetchJson } from "@/lib/client";
import { blocksEta, commas, shortAddress } from "@/lib/format";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { type Fairminter, isXcp69 } from "@/lib/xcp69";

const XCPIO_API = "https://api.xcp.io/v2";

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
 * The scheduled page's living center: countdown, block wall, heartbeat.
 *
 * The wall draws one square per block of the announced wait, capped at 96
 * squares — past that each square stands for total/96 blocks, with a scale
 * caption so it stays honest. The tab title ticks with the count so a
 * pinned tab is itself a countdown.
 */
export function ScheduledPulse({
  asset,
  startBlock,
  announceBlock,
  initialHeight,
}: {
  asset: string;
  startBlock: number;
  announceBlock: number;
  initialHeight: number;
}) {
  const height = useChainHeight(startBlock, initialHeight);
  const total = Math.max(1, startBlock - announceBlock);
  const remaining = Math.min(Math.max(startBlock - height, 0), total);
  const open = remaining <= 0;

  useEffect(() => {
    document.title = open ? `LIVE · ${asset}` : `${remaining} blocks · ${asset}`;
  }, [remaining, open, asset]);

  const cells = Math.min(total, 96);
  const blocksPerCell = total / cells;
  const minedCells = Math.min(cells, Math.floor((total - remaining) / blocksPerCell));

  // Heartbeat: the last Bitcoin block's age, so the page visibly breathes
  // between counterparty polls.
  const { data: tip } = useSWR(
    "btc-tip-block",
    () =>
      fetchJson("https://mempool.space/api/v1/blocks").then(
        (bs: { height: number; timestamp: number }[]) => bs[0] ?? null,
      ),
    { refreshInterval: 60_000 },
  );
  const [nowSec, setNowSec] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNowSec(Date.now() / 1000);
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, []);
  const agoSec =
    tip && nowSec !== null ? Math.max(0, nowSec - tip.timestamp) : null;
  const ago =
    agoSec === null
      ? null
      : agoSec < 90
        ? "just now"
        : agoSec < 3600
          ? `${Math.round(agoSec / 60)}m ago`
          : `${Math.floor(agoSec / 3600)}h ago`;

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

      <div
        className="mx-auto mt-5 grid gap-1 [grid-template-columns:repeat(var(--cols-sm),minmax(0,1fr))] sm:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
        style={
          {
            // Fewer columns on phones so squares stay squares, not dots.
            "--cols": Math.min(cells, 24),
            "--cols-sm": Math.min(cells, 16),
            maxWidth: cells <= 12 ? `${cells * 2.25}rem` : undefined,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        {Array.from({ length: cells }, (_, i) => (
          <span
            key={i}
            className={`aspect-square rounded-[3px] ${
              i < minedCells
                ? "bg-purple-600"
                : i === minedCells && !open
                  ? "animate-pulse bg-purple-300 motion-reduce:animate-none"
                  : "bg-purple-100"
            }`}
          />
        ))}
      </div>
      {blocksPerCell > 1 && (
        <p className="mt-2 text-center text-[11px] text-gray-400 tabular-nums">
          each square ≈ {Math.round(blocksPerCell)} blocks (
          {blocksEta(Math.round(blocksPerCell))})
        </p>
      )}

      {tip && ago && (
        <p className="mt-3 text-center text-xs text-gray-500 tabular-nums">
          <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-green-600 align-middle motion-reduce:animate-none" />
          block {tip.height.toLocaleString()} · {ago}
        </p>
      )}
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

/** Description text for launches whose on-chain description is our hosted
 *  metadata JSON — fetch it and show the human words inside. */
export function HostedDescription({ url }: { url: string }) {
  const { data } = useHostedMeta(url);
  const text =
    data && typeof data.description === "string" && data.description.trim()
      ? data.description
      : null;
  if (!text) return null;
  return (
    <p className="mt-5 border-y border-gray-100 py-4 text-sm leading-relaxed text-gray-600">
      {text}
    </p>
  );
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
          title={s.data}
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
      const prior = (d.result ?? []).filter((r) => r.asset !== currentAsset);
      const closed69 = prior.filter(
        (r) => r.status === "closed" && isXcp69(r),
      );
      // Pool existence is the launched-vs-refunded oracle; a handful of
      // extra calls, so cap at the 8 most recent.
      const pools = await Promise.all(
        closed69.slice(0, 8).map((r) =>
          fetchJson(
            `${COUNTERPARTY_API_BASE}/pools/${encodeURIComponent(r.asset)}/XCP`,
          )
            .then((p: { result: unknown }) => p.result ?? null)
            .catch(() => null),
        ),
      );
      const graduated = pools.filter(Boolean).length;
      const times = prior
        .map((r) => r.block_time)
        .filter((t): t is number => typeof t === "number" && t > 0);
      const earliest = times.length ? Math.min(...times) : null;
      return {
        prior: prior.length,
        judged: pools.length,
        graduated,
        earliest,
      };
    },
    { revalidateOnFocus: false },
  );
  if (!data) return null;

  const sinceYear = data.earliest
    ? new Date(data.earliest * 1000).getFullYear()
    : null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
        {data.prior === 0 ? "first launch" : `${ordinal(data.prior + 1)} launch`}
      </span>
      {data.judged > 0 && (
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 tabular-nums">
          {data.graduated} graduated · {data.judged - data.graduated} refunded
        </span>
      )}
      {data.prior > 0 && sinceYear && (
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600 tabular-nums">
          launching since {sinceYear}
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
      title={copied ? "Copied" : "Copy address"}
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
    <div className="group relative mt-1 inline-block">
      <p className="text-[13px] text-gray-500 tabular-nums">
        by{" "}
        <a
          href={`https://xcp.io/address/${source}`}
          target="_blank"
          rel="noreferrer"
          title={source}
          className="hover:text-purple-600 hover:underline"
        >
          {shortAddress(source)}
        </a>
        <CopyButton value={source} />
      </p>
      {data && (
        /* pt-2 (not mt-2) keeps the card's hit area touching the line, so the
           pointer can travel into it without the hover breaking. */
        <div className="invisible absolute left-0 top-full z-40 pt-2 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
          <div className="w-[19rem] max-w-[calc(100vw-2.5rem)] rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-gray-50 p-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  XCP balance
                </div>
                <div className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
                  {xcpNum === null || Number.isNaN(xcpNum)
                    ? "—"
                    : commas(xcpNum)}
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  First seen
                </div>
                <div className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
                  {data.firstSeen ? monthYear(data.firstSeen) : "—"}
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
                Track record {Math.round(score)}/100 ({tier}) — observed
                on-chain history, not an endorsement.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- artwork ---------- */

/** The poster art: compact in the card, full-size on click. */
export function ArtLightbox({ asset }: { asset: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View ${asset} artwork full size`}
        title="Click to enlarge"
        className="group shrink-0 cursor-zoom-in"
      >
        <TokenImage
          asset={asset}
          large
          className="size-[5.5rem] rounded-2xl bg-gray-100 object-cover shadow-sm transition-transform group-hover:scale-[1.03]"
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${asset} artwork, enlarged`}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6"
        >
          <TokenImage
            asset={asset}
            large
            className="max-h-[85vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl sm:max-w-[36rem]"
          />
        </div>
      )}
    </>
  );
}
