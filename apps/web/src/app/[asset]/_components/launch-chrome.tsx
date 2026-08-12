"use client";

import { useState } from "react";
import useSWR from "swr";
import { HeroTokenImage, TokenImage } from "@/components/token-image";
import { Dialog } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/client";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

import { SOCIAL_ICONS } from "@/app/[asset]/_components/launch-metadata";
import { FOCUS } from "@/components/ui/tokens";
import { timeAgo, monthYear } from "@/lib/chain-time";

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
  // Gray, not amber or red: this one isn't a warning or a loss to flag,
  // it's just over — every participant got their XCP back.
  refunded: {
    label: "\u{1F480} RIP",
    className: "border-gray-200 bg-gray-100 text-gray-500",
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

/** Relative time since a block, for facts with no single transaction to
 *  point at the way an announcement has — a refund settles as a ledger
 *  event inside the deadline block, not a transaction of its own. */
export function BlockAgo({ blockIndex }: { blockIndex: number }) {
  const { data: at } = useSWR(
    ["block-time", blockIndex],
    () =>
      (fetchJson(`${COUNTERPARTY_API_BASE}/blocks/${blockIndex}`) as Promise<{
        result: { block_time: number };
      }>)
        .then((d) => d.result.block_time)
        .catch(() => null),
    { revalidateOnFocus: false },
  );
  return <>{at ? timeAgo(at) : "—"}</>;
}

/** "Aug 2026" for a block — a calendar fact, not a relative one, for a
 *  headline that reads as a record rather than a live countdown. */
export function BlockMonthYear({ blockIndex }: { blockIndex: number }) {
  const { data: at } = useSWR(
    ["block-time", blockIndex],
    () =>
      (fetchJson(`${COUNTERPARTY_API_BASE}/blocks/${blockIndex}`) as Promise<{
        result: { block_time: number };
      }>)
        .then((d) => d.result.block_time)
        .catch(() => null),
    { revalidateOnFocus: false },
  );
  return <>{at ? monthYear(at) : "—"}</>;
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
        <HeroTokenImage
          asset={asset}
          className={`aspect-square w-full rounded-2xl bg-gray-100 object-cover shadow-sm transition-transform group-hover:scale-[1.03] sm:aspect-auto sm:w-auto sm:size-[5.5rem]`}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={asset} variant="lightbox">
        <HeroTokenImage
          asset={asset}
          className="h-full w-full rounded-2xl object-contain shadow-2xl"
        />
      </Dialog>
    </>
  );
}
