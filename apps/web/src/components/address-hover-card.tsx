"use client";

import { type ReactNode, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { HoverCard } from "@/components/ui/hover-card";
import { fetchJson } from "@/lib/client";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import {
  commas,
  compact,
  shortAddress,
  tokenQty,
} from "@/lib/format";
import { big, type RawLike } from "@/lib/numeric";
import { fetchLaunchpadAddressSummary } from "@/lib/api/launchpad-api";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import {
  type Fairminter,
  isXcp69,
  windowIsExact,
  xcp69Params,
} from "@/lib/xcp69";

import { LABEL, FOCUS } from "@/components/ui/tokens";
import { timeAgo, daysSince, monthYear } from "@/lib/chain-time";
import { XCP_API_BASE } from "@/lib/constants";

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
      //
      // "Prior" has to mean prior IN CHAIN ORDER, not merely "not this one".
      // Judging against everything the creator ever launched made each of two
      // launches call the other its predecessor — both read "2nd launch", and
      // the older one cited a launch from its own future. The cutoff is the
      // current launch's tx_index, NOT its block_time: five launches announced
      // in one block share a timestamp, and a strict time cutoff made each
      // exclude the other four, so all five claimed the same ordinal. tx_index
      // is the chain's own total order, within a block and across them. An
      // unconfirmed launch has no confirmed tx_index in this listing and is
      // genuinely newest, so it counts everything before it.
      const rows = d.result ?? [];
      const currentIdx = rows.find((r) => r.asset === currentAsset)?.tx_index ?? Infinity;
      const priorRows = rows
        .filter(
          (r) =>
            r.asset !== currentAsset &&
            xcp69Params(r) &&
            (r.tx_index ?? 0) < currentIdx,
        )
        .sort((a, b) => (b.tx_index ?? 0) - (a.tx_index ?? 0));
      // Full conformance costs one event fetch per launch, so only the eight
      // most recent are judged all the way down (they also feed the record
      // chip). The rest count on their parameters alone — the ordinal used to
      // saturate here instead, reading "9th launch" on every launch past a
      // creator's ninth.
      const shaped = priorRows.slice(0, 8);
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

      // Point FORWARD, not back. Someone who lands on an old launch is asking
      // "is this creator still around, and what are they doing now" — the
      // answer is their newest launch, not the one that preceded this one.
      // On the newest launch itself there is nothing newer to offer, so the
      // chip falls back to the one before it.
      const newer = rows
        .filter((r) => r.asset !== currentAsset && xcp69Params(r) && (r.tx_index ?? 0) > currentIdx)
        .sort((a, b) => (b.tx_index ?? 0) - (a.tx_index ?? 0));
      const latest = newer[0];
      return {
        // Everything before this launch: the judged recent eight (minus any
        // that failed conformance) plus the params-only remainder.
        prior: priorRows.length - shaped.length + prior.length,
        priorCapped: (d.result ?? []).length >= 100,
        judged: judged.length,
        graduated: judged.filter((p) => p === "graduated").length,
        // Only ever forward. On the creator's newest launch there is nothing
        // newer to send anyone to, and pointing backwards would just walk a
        // visitor away from the live one — so that page leans on the track
        // record instead.
        latest: latest?.block_time
          ? { asset: latest.asset, at: latest.block_time }
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
    "rounded-full border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-400 tabular-nums";

  // Ordered by how much each says about the creator, because on a phone only
  // the first two survive. A third and fourth chip wrapped onto their own
  // line and pushed the launch itself further down the screen — on the page
  // someone opened from a shared link, the creator's track record is context,
  // not the headline.
  const MOBILE_CHIPS = 2;
  const chips: ReactNode[] = [
    <span
      key="ordinal"
      className="rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:text-purple-300"
    >
      {data.prior === 0
        ? "first launch"
        : data.priorCapped
          ? `${commas(data.prior)}+ launches`
          : `${ordinal(data.prior + 1)} launch`}
    </span>,
  ];
  if (data.judged > 0) {
    chips.push(
      <span key="record" className={chip}>
        {data.judged > 1
          ? `${Math.round((data.graduated / data.judged) * 100)}% graduated (${data.graduated}/${data.judged})`
          : `${data.graduated} graduated · ${data.judged - data.graduated} refunded`}
      </span>,
    );
  }
  if (data.latest) {
    chips.push(
      <Link
        key="latest"
        href={`/${data.latest.asset}`}
        className={`${chip} transition-colors hover:border-purple-300 dark:hover:border-purple-700 hover:text-purple-600 dark:hover:text-purple-400`}
      >
        latest launch {timeAgo(data.latest.at)}
        {/* The ticker is the widest part of this chip and the least of what
            it says — "there is a newer one, and it's recent" is the whole
            point, and the link carries you there either way. */}
        <span className="hidden sm:inline"> · {data.latest.asset}</span>
      </Link>,
    );
  }
  if (data.prior === 0 && standing) {
    chips.push(
      <span key="standing" className={chip}>
        {standing}
      </span>,
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c, i) => (
        // `contents` so the wrapper never becomes a layout box of its own —
        // the chip stays a direct participant in the flex row above `sm`.
        <span key={i} className={i < MOBILE_CHIPS ? "contents" : "hidden sm:contents"}>
          {c}
        </span>
      ))}
      {trailing}
    </div>
  );
}

/* ---------- issuer identity ---------- */

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;

interface Reputation {
  track_record?: { score?: number; tier?: string };
}

export interface AddressSummary {
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
      (fetchJson(`${XCP_API_BASE}/addresses/${source}/summary`) as Promise<{
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
    `${XCP_API_BASE}/addresses/${source}/issued?limit=${CAP}`,
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
      className={`relative ml-1 inline-flex size-5 items-center justify-center rounded align-[-3px] text-gray-400 dark:text-gray-500 transition-colors after:absolute after:-inset-3 after:content-[''] hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-purple-600 dark:hover:text-purple-400 ${FOCUS}`}
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
 * Any address, wrapped in an at-a-glance card on hover/focus (tap on
 * touch): XCP balance and first-seen date as the headline numbers, tokens
 * held and issued below, track record as a footnote. `children` is just the
 * visible content — a short address, an identicon row, whatever the caller
 * wants — this component builds the actual link/button around it (and
 * still goes to the explorer either way), so touch users lose only the
 * preview, never the navigation.
 *
 * Every fetch is gated on `armed` (first hover/tap), not page load — the
 * cost of adding this to N rows of a table is "one more request when
 * someone actually looks," never N requests up front.
 */
export function AddressHoverCard({
  source,
  className = "",
  children,
}: {
  source: string;
  className?: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const coarse = useCoarsePointer();
  const summary = useAddressSummary(armed ? source : null);
  const firstSeen = useFirstSeen(summary?.first_block);
  const { data: rep } = useSWR(
    armed ? ["reputation", source] : null,
    () =>
      (fetchJson(`${XCP_API_BASE}/addresses/${source}/reputation`) as Promise<{
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
    <HoverCard
      touch={coarse}
      onArm={() => setArmed(true)}
      trigger={
        // A tap can't hover, so it opens the card instead of navigating; the
        // profile and explorer links both live inside the card either way.
        coarse ? (
          <button type="button" className={`rounded ${FOCUS} ${className}`}>
            {children}
          </button>
        ) : (
          <Link
            href={`/profile/${source}`}
            className={`rounded hover:underline ${FOCUS} ${className}`}
          >
            {children}
          </Link>
        )
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
          <div className={LABEL}>XCP balance</div>
          <div className="mt-0.5 text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
            {xcpNum === null || Number.isNaN(xcpNum) ? "—" : commas(xcpNum)}
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
          <div className={LABEL}>First seen</div>
          <div className="mt-0.5 text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
            {firstSeen ? monthYear(firstSeen) : "—"}
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
          Holds{" "}
          <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
            {typeof held === "number" ? commas(held) : "—"}
          </span>{" "}
          {held === 1 ? "token" : "tokens"}
        </div>
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
          Issued{" "}
          <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
            {issued
              ? `${commas(issued.count)}${issued.capped ? "+" : ""}`
              : "—"}
          </span>{" "}
          {issued?.count === 1 && !issued.capped ? "token" : "tokens"}
        </div>
      </div>
      {typeof score === "number" && tier && (
        <p className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-2 text-[10px] text-gray-400 dark:text-gray-500">
          Track record {Math.round(score)}/100 ({tier}) — observed on-chain
          reputation from the XCP.io explorer, not an endorsement.
        </p>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs font-medium">
        <Link href={`/profile/${source}`} className="text-purple-600 dark:text-purple-400 hover:underline">
          View profile
        </Link>
        <a
          href={`https://xcp.io/address/${source}`}
          target="_blank"
          rel="noreferrer"
          className="text-gray-500 dark:text-gray-400 hover:underline"
        >
          Explorer ↗
        </a>
      </div>
    </HoverCard>
  );
}

/**
 * A launchpad-native preview for a trader row.
 *
 * Unlike AddressHoverCard this never calls XCP.io. One request, armed by the
 * hover itself, reads the mint and market indexes xcp.fun already maintains.
 * The caller supplies the live balance and pool reserves already present on
 * the asset page; PnL is shown only when that balance exactly reconciles with
 * the focused mint/trade history. Sends, LP actions and other outside movement
 * therefore produce an activity summary, not a confident but wrong basis.
 */
export function LaunchpadAddressHoverCard({
  source,
  asset,
  balanceRaw,
  poolXcpRaw,
  poolTokenRaw,
  className = "",
  children,
}: {
  source: string;
  asset: string;
  balanceRaw?: RawLike;
  poolXcpRaw?: RawLike;
  poolTokenRaw?: RawLike;
  className?: string;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const coarse = useCoarsePointer();
  const { data, isLoading } = useSWR(
    armed ? ["launchpad-address-summary", source, asset] : null,
    () => fetchLaunchpadAddressSummary(source, asset),
    { revalidateOnFocus: false },
  );

  const balance = balanceRaw === undefined ? null : big(balanceRaw);
  const xcpReserve = poolXcpRaw === undefined ? 0n : big(poolXcpRaw);
  const tokenReserve = poolTokenRaw === undefined ? 0n : big(poolTokenRaw);
  const tracked = data?.asset.tracked;
  const reconciles = Boolean(
    tracked?.complete &&
      balance !== null &&
      big(tracked.quantity) === balance &&
      tokenReserve > 0n,
  );
  const value =
    reconciles && balance !== null
      ? (balance * xcpReserve) / tokenReserve
      : null;
  const pnl =
    value !== null && tracked
      ? big(tracked.realized_pnl_xcp) + value - big(tracked.cost_xcp)
      : null;
  const xcp = (raw: RawLike) => compact(tokenQty(raw, true));
  const signedXcp = (raw: bigint) =>
    `${raw > 0n ? "+" : ""}${compact(tokenQty(raw, true))} XCP`;

  return (
    <HoverCard
      touch={coarse}
      onArm={() => setArmed(true)}
      trigger={
        coarse ? (
          <button type="button" className={`rounded ${FOCUS} ${className}`}>
            {children}
          </button>
        ) : (
          <Link
            href={`/profile/${source}`}
            className={`rounded hover:underline ${FOCUS} ${className}`}
          >
            {children}
          </Link>
        )
      }
    >
      {isLoading || !data ? (
        <p className="py-3 text-center text-sm text-gray-400 dark:text-gray-500">
          {isLoading ? "Loading xcp.fun activity…" : "Activity unavailable."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <div className={LABEL}>Balance</div>
              <div className="mt-0.5 text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                {balance === null ? "—" : compact(tokenQty(balance, true))}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
              <div className={LABEL}>Total PnL</div>
              <div
                className={`mt-0.5 text-lg font-bold tabular-nums ${
                  pnl === null
                    ? "text-gray-400 dark:text-gray-500"
                    : pnl >= 0n
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                }`}
              >
                {pnl === null ? "—" : signedXcp(pnl)}
              </div>
            </div>
          </div>
          <div className="mt-2 whitespace-nowrap rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-900 dark:text-gray-100">Mint </span>
            <span className="tabular-nums">{xcp(data.asset.minted_xcp ?? "0")}</span>
            {" · Buy "}
            <span className="tabular-nums">{xcp(data.asset.bought_xcp)}</span>
            {" · Sell "}
            <span className="tabular-nums">{xcp(data.asset.sold_xcp)} XCP</span>
          </div>
          <div className="mt-2 whitespace-nowrap rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2 text-xs text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-900 dark:text-gray-100">XCP-69</span>
            {` · ${commas(data.mints.transactions)} mint${data.mints.transactions === 1 ? "" : "s"}`}
            {` · ${commas(data.mints.launches)} launch${data.mints.launches === 1 ? "" : "es"}`}
            {data.market.fills > 0
              ? ` · ${commas(data.market.fills)} fill${data.market.fills === 1 ? "" : "s"}`
              : ""}
          </div>
          {pnl === null &&
            (data.asset.mints > 0 || data.asset.buys > 0 || data.asset.sells > 0) && (
              <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                PnL is withheld because the live balance includes activity outside indexed mints and trades.
              </p>
            )}
        </>
      )}
      <div className="mt-2 text-xs font-medium">
        <Link href={`/profile/${source}`} className="text-purple-600 dark:text-purple-400 hover:underline">
          View profile
        </Link>
      </div>
    </HoverCard>
  );
}

/**
 * "by 1FairP…pkiGfX" with a copy button, and the address hover card above.
 * The link still goes to the explorer, so touch users lose only the preview.
 */
export function IssuerLine({ source }: { source: string }) {
  return (
    <span className="mt-1 inline-block text-[13px] text-gray-500 dark:text-gray-400 tabular-nums">
      by{" "}
      <AddressHoverCard source={source}>{shortAddress(source)}</AddressHoverCard>
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
