"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetchJson } from "@/lib/client";
import { METADATA_ORIGIN } from "@/lib/metadata";
import { inscriptionContentUrl } from "@/lib/constants";

import { FOCUS } from "@/components/ui/tokens";

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
export function LaunchDescription({
  text,
  marginClassName = "mt-5",
}: {
  text: string;
  /** Override the top margin — minting lines this up with the live
   *  progress card above it, which scheduled doesn't need. */
  marginClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);
  return (
    <blockquote className={`${marginClassName} border-l-[3px] border-purple-100 dark:border-purple-900 pl-4`}>
      <p
        ref={ref}
        className={`text-sm leading-relaxed text-gray-600 dark:text-gray-400 ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`mt-1.5 rounded text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-500 dark:hover:text-purple-400 ${FOCUS}`}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </blockquote>
  );
}

/** Description for launches whose on-chain description is our hosted
 *  metadata JSON — fetch it and show the human words inside. */
export function HostedDescription({
  url,
  marginClassName,
}: {
  url: string;
  marginClassName?: string;
}) {
  const { data } = useHostedMeta(url);
  const text =
    data && typeof data.description === "string" && data.description.trim()
      ? data.description.trim()
      : null;
  if (!text) return null;
  return <LaunchDescription text={text} marginClassName={marginClassName} />;
}

export const SOCIAL_ICONS: Record<string, { label: string; path: string }> = {
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
          className={`relative flex size-[26px] items-center justify-center rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 transition-colors after:absolute after:-inset-2 after:content-[''] hover:border-purple-300 dark:hover:border-purple-700 hover:bg-white dark:hover:bg-gray-900 hover:text-purple-600 dark:hover:text-purple-400 ${FOCUS}`}
        >
          <svg viewBox="0 0 24 24" className="size-[13px] fill-current">
            <path d={SOCIAL_ICONS[s.type]!.path} />
          </svg>
        </a>
      ))}
    </div>
  );
}

/** For an inscribed launch: the content is the on-chain description itself
 *  (see fm.mime_type), not a URL — this is the only place that fact is
 *  visible, so it gets its own chip, linked out to where the inscription
 *  actually lives. `txHash` is the fairminter's creating transaction,
 *  which is also the inscription's reveal transaction (same tx carries
 *  both the ordinal envelope and the Counterparty message).
 *
 *  /content, not /inscription: this points at the inscribed thing itself
 *  rather than the record describing it. GENXSIXNINE inscribed a live mint
 *  viewer as text/html, so /content opens the artwork running; /inscription
 *  opens a page of metadata about a page. Same id either way. */
export function InscriptionChip({ txHash }: { txHash: string }) {
  return (
    <a
      href={inscriptionContentUrl(txHash)}
      target="_blank"
      rel="noreferrer"
      className="rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-400 tabular-nums transition-colors hover:border-purple-300 dark:hover:border-purple-700 hover:text-purple-600 dark:hover:text-purple-400"
    >
      inscription ↗
    </a>
  );
}

/* ---------- issuer reputation ---------- */


/**
 * A few facts about the issuing address: how many launches before this one,
 * and how the XCP-69 ones ended (pool row = graduated, none = refunded).
 * Fetched lazily so the poster paints first; renders nothing while loading
 * or for a first-time issuer beyond the "first launch" chip.
 */

/** ~90 days, in blocks — the same "new address" threshold IssuerChips uses,
 *  applied here from block height instead of a second block-time lookup
 *  per address (halving the request count for no real loss of precision). */
