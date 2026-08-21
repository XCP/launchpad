"use client";

import Link from "next/link";
import { DropdownMenu as DM } from "radix-ui";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { PendingDot } from "@/components/pending-dot";
import { useMempool } from "@/hooks/use-mempool";
import { LABEL } from "@/components/ui/tokens";
import { blocksEta, commas, compact, fromSats, shortAddress, usd } from "@/lib/format";
import type { MempoolMint } from "@/lib/api/counterparty";
import type { MempoolOrder } from "@launchpad/xcp69/mempool";
import { fetchLaunchPage } from "@/lib/api/launchpad-api";
import { fetchHolderCount } from "@/lib/api/xcpio";
import {
  type LaunchPage,
  PER_PAGE,
  type SectionRow,
  toSectionRow,
} from "@/lib/launch-row";
import { type LaunchPhase, saleProgress, XCP69_MIN_PARTICIPANTS } from "@/lib/xcp69";
import { ratio } from "@/lib/numeric";
import { useWallet } from "@/lib/wallet/wallet-context";

type View = "grid" | "table";

/**
 * How often a section re-asks for the page it is showing.
 *
 * Not tuned to how fast the chain moves — tuned to how fast this site can
 * possibly know. The indexer's cron is every five minutes and /v2/launches is
 * edge-cached for sixty seconds, so asking any faster returns the same bytes
 * out of the same colo cache. Behind that cache this is roughly one origin
 * read per colo per minute however many tabs are open, which is what makes
 * polling affordable at all.
 */
const INDEX_REFRESH_MS = 60_000;

/**
 * The rate the header's mempool chip already polls at, restated so the two
 * agree deliberately rather than by coincidence.
 *
 * useMempool keys every caller to ONE SWR entry, so a section joining this
 * costs no second request — the unconfirmed mints a card counts are the ones
 * the chip in the header is already holding.
 */
const MEMPOOL_REFRESH_MS = 30_000;

/**
 * Unconfirmed mints, counted per asset.
 *
 * The mempool feed carries fairminters and fairmints and nothing else — no
 * pool trades — so this can only be non-zero for a launch still taking mints.
 * Every phase is looked up anyway rather than gated on `minting`: a launch
 * that fills its soft cap with mints still queued behind it is exactly when
 * the count is worth seeing, and that launch has already graduated by then.
 */
function pendingByAsset(mints: MempoolMint[], orders: MempoolOrder[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of mints) counts.set(m.asset, (counts.get(m.asset) ?? 0) + 1);
  for (const o of orders) counts.set(o.asset, (counts.get(o.asset) ?? 0) + 1);
  return counts;
}

interface SortOption {
  id: string;
  label: string;
  by: (a: SectionRow, b: SectionRow) => number;
}

/**
 * Age rank, in blocks.
 *
 * announceBlock is the honest answer — when it's there. It arrives as 0 for
 * any launch whose announcement block was never recorded, and 0 sorts the
 * NEWEST launch to the BOTTOM of "Newest", which is the opposite of what the
 * control promises. start_block stands in: always present, always later than
 * the announcement it stands for, and on the same scale, so the ordering
 * stays truthful even in a section mixing rows that have it with rows that
 * don't.
 */
const announced = (r: SectionRow) =>
  r.announceBlock > 0 ? r.announceBlock : r.fm.start_block;

/**
 * Minter count as a rank.
 *
 * Null means the count was not available, not that nobody minted, so it sorts
 * BELOW a genuine zero rather than tying with it. In practice a section is
 * either all-counted or all-unknown — the fallback derivation is all-or-none —
 * so this decides ties in the second case and nothing in the first.
 */
const minterRank = (r: SectionRow) => r.minters ?? -1;

/** The count as a cell or a card reads it: an em dash for "not counted",
 *  which is the same convention the market-cap and deadline columns already
 *  use for a figure that isn't there. */
const minterText = (n: number | null) => (n === null ? "—" : commas(n));
const holderText = (n: number | null) => (n === null ? "—" : commas(n));

/**
 * Each phase is judged by its own measure, so each gets its own sort menu
 * rather than one shared list where two thirds of the options are inert.
 * The first entry is the default, and matches the order apps/api already
 * returns the section in.
 *
 * Every `id` here is a key of SORT_SQL in apps/api/src/queries/launches.ts —
 * that is the contract, and it is why these are terse strings rather than
 * anything descriptive. The sort now happens in the database, because a
 * section holds ONE PAGE: sorting what the browser has would order 24 of 30
 * rows and call it the ranking. `by` has not been deleted along with the old
 * client-side sort, because it is still what orders the section when the API
 * is unreachable and the page falls back to deriving launches live — see the
 * `paged` prop on Section. The two must agree, so a change to one of these
 * comparators is a change to the SQL beside it.
 */
const SORTS: Record<string, SortOption[]> = {
  graduated: [
    { id: "mcap", label: "Market cap", by: (a, b) => b.marketCapXcp - a.marketCapXcp },
    { id: "minters", label: "Minters", by: (a, b) => minterRank(b) - minterRank(a) },
    { id: "newest", label: "Newest", by: (a, b) => announced(b) - announced(a) },
  ],
  minting: [
    // First, so it is the default — and it must stay in step with
    // DEFAULT_SORT.minting in apps/api/src/queries/launches.ts, which is what
    // the server renders page one with.
    { id: "progress", label: "Progress", by: (a, b) => b.progress - a.progress },
    // The window is fixed by the standard at start_block + 1,000, so the
    // deadline is exact and closing order never contradicts opening order.
    // end_block is NOT the field for this: it is 0 on every conforming
    // launch, and sorting by it would return one arbitrary order.
    {
      id: "closing",
      label: "Closing soonest",
      by: (a, b) => a.fm.soft_cap_deadline_block - b.fm.soft_cap_deadline_block,
    },
    { id: "minters", label: "Minters", by: (a, b) => minterRank(b) - minterRank(a) },
    { id: "newest", label: "Newest", by: (a, b) => announced(b) - announced(a) },
  ],
  scheduled: [
    { id: "soonest", label: "Soonest", by: (a, b) => a.fm.start_block - b.fm.start_block },
    // Announced-age, the same as every other Newest on the page. This used to
    // be start_block DESC, which for a scheduled launch is not "newest" at all
    // — it is "opens last", the exact reverse of the option above it. Two
    // controls that were really one axis in both directions.
    { id: "newest", label: "Newest", by: (a, b) => announced(b) - announced(a) },
  ],
};

/** Every section tabulates. Scheduled has less to line up than the others —
 *  no progress, no raise — but the toggle is one page-level choice, and a
 *  section that silently ignored it read as a broken control rather than as
 *  a section with nothing to show. */
const TABULAR = new Set(["graduated", "minting", "scheduled"]);

/**
 * PER_PAGE is now the LIMIT on a query as well as the width of a slice, which
 * is why it lives in lib/launch-row.ts beside the row shapes — the server
 * renders page one with it and this fetches the rest with it.
 *
 * There used to be a second number: a table page held 25 where a grid page
 * held 24. With paging server-side that would mean toggling the view silently
 * re-fetched and reshuffled which launches you were looking at. The view is a
 * way of drawing a page, not a different page.
 */

/** The first page of each section, as the server rendered it. */
export interface InitialPages {
  graduated: LaunchPage;
  minting: LaunchPage;
  scheduled: LaunchPage;
}

export function LaunchSections({
  initial,
  paged,
  height,
  xcpUsd,
}: {
  initial: InitialPages;
  /**
   * Whether more pages can be asked for.
   *
   * True in the normal case: each `LaunchPage` is page one of a phase and the
   * rest are a request away. False when the API was unreachable and the page
   * derived every launch live from Counterparty — then each `rows` already IS
   * the whole phase, and the sections sort and slice it themselves. The
   * distinction is not cosmetic: paging a set that is already complete would
   * ask an API that just failed for rows it already has.
   */
  paged: boolean;
  height: number;
  xcpUsd: number | null;
}) {
  // One choice for the whole page: picking Table in one section and finding
  // the next still in cards reads as a bug, not a setting. Sections that
  // can't tabulate simply ignore it.
  const [view, setView] = useState<View>("grid");
  const { address, status: walletStatus } = useWallet();
  // The wallet itself is desktop-only (the header hides it below `sm`), and
  // this control follows the same boundary. Keep the data guard here too: CSS
  // decides visibility, but a disconnected phone must not start personalised
  // API reads merely because the hidden component still exists in the DOM.
  const walletAddress = walletStatus === "connected" && address ? address : null;
  // One lookup for the whole page, built from the poll the header chip is
  // already running. Sections read it; none of them fetches it.
  const { mints, orders } = useMempool(MEMPOOL_REFRESH_MS);
  const pendingMints = useMemo(() => pendingByAsset(mints, orders), [mints, orders]);

  return (
    <div className="space-y-10">
      {/* Graduated leads by position only. The holographic border on its cards
          already marks them out, and a tinted panel around them said the same
          thing a second time. */}
      <Section
        phase="graduated"
        title="Graduated"
        empty=""
        initial={initial.graduated}
        paged={paged}
        pendingMints={pendingMints}
        height={height}
        xcpUsd={xcpUsd}
        view={view}
        onView={setView}
        walletAddress={null}
      />

      <Section
        phase="minting"
        title="Minting"
        empty="No live launches. Start one — it sells out or everyone gets refunded."
        initial={initial.minting}
        paged={paged}
        pendingMints={pendingMints}
        height={height}
        xcpUsd={xcpUsd}
        view={view}
        onView={setView}
        // Only a live launch is an opportunity someone can still act on.
        // Scheduled launches cannot have mints, and graduated launches cannot
        // be minted again, so offering the filter there would be inert/history
        // filtering rather than the requested "what haven't I minted yet?".
        walletAddress={paged ? walletAddress : null}
      />

      <Section
        phase="scheduled"
        title="Scheduled"
        empty=""
        initial={initial.scheduled}
        paged={paged}
        pendingMints={pendingMints}
        height={height}
        xcpUsd={xcpUsd}
        view={view}
        onView={setView}
        walletAddress={null}
      />

    </div>
  );
}

/**
 * One phase's section: a heading, its controls, and one page of launches.
 *
 * The page is a query, not a slice. Changing the sort or the page number asks
 * the API for that page of that ordering and swaps in what comes back, so the
 * count beside the heading, the rows below it and the pager under those are
 * three views of one answer. They used to be three readings of different
 * things — the count came from /v2/stats, the rows from a fixed prefetch, the
 * pager from dividing that prefetch — which is how the section could print
 * "Minting 30" above a list of 24 with no page two, and why a launch that had
 * not been minted yet was unreachable from every control on the page.
 *
 * `paged` false keeps the old behaviour for the one case that still needs it:
 * the API being down, where the page hands over every launch it derived live
 * and this sorts and slices in memory.
 */
function Section({
  phase,
  title,
  empty,
  initial,
  paged,
  pendingMints,
  height,
  xcpUsd,
  view,
  onView,
  walletAddress,
}: {
  phase: LaunchPhase;
  title: string;
  empty: string;
  initial: LaunchPage;
  paged: boolean;
  /** Unconfirmed mints per asset, from the page-level poll. */
  pendingMints: Map<string, number>;
  height: number;
  xcpUsd: number | null;
  view: View;
  onView: (v: View) => void;
  /** Connected wallet eligible for the live-launch filter. Null hides it. */
  walletAddress: string | null;
}) {
  const options = SORTS[phase] ?? SORTS.scheduled!;
  const defaultSort = options[0]!.id;
  const [sortId, setSortId] = useState(defaultSort);
  const [page, setPage] = useState(0);
  // Store the address that enabled the filter rather than a bare boolean. If
  // the user switches wallets, the new wallet does not inherit the old one's
  // checked preference or personalised query.
  const [hideMintedBy, setHideMintedBy] = useState<string | null>(null);
  const hideMinted = walletAddress !== null && hideMintedBy === walletAddress;
  const unmintedBy = hideMinted ? walletAddress : undefined;
  const perPage = PER_PAGE[phase] ?? 12;

  // Unpaged: the whole phase is already here, so ordering and slicing are
  // this component's job. `null` in the paged case, which is what every read
  // below branches on.
  const local = useMemo(() => {
    if (paged) return null;
    const by = (options.find((o) => o.id === sortId) ?? options[0]!).by;
    return [...initial.rows].sort(by);
  }, [paged, initial.rows, options, sortId]);

  const atDefault = sortId === defaultSort && page === 0 && !unmintedBy;

  /**
   * How long the phase was, as of the last answer that arrived.
   *
   * State rather than something read off the response below, because it is an
   * INPUT to that request: the cursor has to be clamped against a length
   * before the offset can be worked out, and a hook's result does not exist
   * before the hook. The version this replaced derived the same bound from
   * its own `fetched` state for the same reason.
   *
   * Polling is what makes it matter. A phase can shrink WHILE someone sits on
   * its last page — a launch graduates and Minting is a page shorter than it
   * was — and clamping only what is drawn would leave the section asking for
   * an offset that no longer exists, forever, since nothing else would move
   * the cursor back.
   */
  const [knownTotal, setKnownTotal] = useState(initial.total);

  const total = local ? local.length : knownTotal;
  const pages = Math.max(1, Math.ceil(total / perPage));
  // Clamped on read, never in an effect: an effect would render the stale
  // cursor once before correcting it, and would ask for that page on the way.
  const current = Math.min(page, pages - 1);

  /**
   * The page this section is showing, kept current rather than fetched once.
   *
   * SWR rather than the fetch-into-state this replaced, for three properties
   * that were each hand-rolled here and one that was not here at all: a reply
   * for an abandoned page cannot land on top of a newer one, the last good
   * page stays on screen while the next is in the air, a failure retries
   * itself instead of latching a flag — and `refreshInterval` is what means
   * the section no longer needs a reload to notice that the chain moved.
   */
  const { data, error, isLoading } = useSWR<LaunchPage>(
    paged ? ["launch-page", phase, sortId, current, perPage, unmintedBy ?? null] : null,
    async () => {
      const res = await fetchLaunchPage(
        phase,
        sortId,
        perPage,
        current * perPage,
        unmintedBy,
      );
      // Thrown, not returned as null: an error leaves SWR holding the last
      // page that loaded, which is what belongs on screen, and it schedules
      // its own retry. Returning null would CACHE the failure as the answer.
      if (!res) throw new Error(`no ${phase} page ${current}`);
      return {
        rows: res.rows.map(toSectionRow),
        total: res.total,
        king: res.king ? toSectionRow(res.king) : null,
      };
    },
    {
      // Page one of the default ordering is what the document was rendered
      // with, so it is never re-asked on arrival — that would be a round trip
      // to land back where we started. `revalidateOnMount` suppresses only
      // the mount: a sort or page change is a new key and still fetches, and
      // the interval below still runs.
      fallbackData: atDefault ? initial : undefined,
      revalidateOnMount: false,
      refreshInterval: INDEX_REFRESH_MS,
      keepPreviousData: true,
      revalidateOnFocus: true,
      // Every page carries the length of the phase it came from, so each
      // answer re-bounds the next cursor. Unchanged on a quiet refresh, which
      // React bails out of rather than re-rendering.
      onSuccess: (p) => setKnownTotal(p.total),
    },
  );

  // Dim only while a page we do NOT have yet is in the air. A background
  // refresh of the page already on screen must never dim it — that would be
  // the whole section flickering once a minute to report that nothing had
  // changed.
  const pending = isLoading;
  const failed = Boolean(error);

  const shown = local
    ? local.slice(current * perPage, current * perPage + perPage)
    : (data ?? initial).rows;

  // The launch index knows who minted; ownership can change afterward. Ask
  // Explorer only for the graduated page on screen, and retain that answer
  // for five minutes. Page one arrives prefilled by the server, so the common
  // path makes no browser-side burst at all.
  const holderAssets =
    phase === "graduated" && shown.some((row) => row.holders === null)
      ? shown.map((row) => row.fm.asset)
      : [];
  const { data: liveHolders } = useSWR<Record<string, number | null>>(
    holderAssets.length > 0 ? ["graduated-holders", ...holderAssets] : null,
    async () =>
      Object.fromEntries(
        await Promise.all(
          holderAssets.map(async (asset) => [asset, await fetchHolderCount(asset)] as const),
        ),
      ),
    { dedupingInterval: 300_000, refreshInterval: 300_000, revalidateOnFocus: false },
  );
  const displayed = liveHolders
    ? shown.map((row) => ({ ...row, holders: liveHolders[row.fm.asset] ?? row.holders }))
    : shown;

  /**
   * Who is reigning, according to the last answer that arrived.
   *
   * Null on the unpaged path deliberately. That path is the live Counterparty
   * derivation, which cannot answer "who minted most recently" at all — so the
   * section shows no pinned slot rather than a guess, and the crown reappears
   * when the index does.
   */
  const king = local ? null : (data ?? initial).king;

  /**
   * The front slot: the minting launch with the most mints queued behind it
   * right now: the launch that minted most recently, holding the slot until
   * another one mints.
   *
   * A crown that passes, not a rank that is recomputed. It does not empty when
   * the mempool drains — once anything has minted, somebody is reigning —
   * which is the difference between this and a busiest-right-now leaderboard.
   *
   * The holder comes from the worker (`king`), never from `shown`. The rows
   * here are ONE PAGE of the phase, and the reigning launch is usually not
   * among them: on the live database the crown sat on a launch that page one
   * of the progress sort did not contain. Choosing from what this component
   * happens to hold would crown the best of twelve and present it as the best
   * of forty.
   *
   * Which is also why it is prepended rather than reordered. The holder is
   * pulled to the front if the page already has it, and added to the front if
   * it does not — so the slot is filled on every page, not just the one the
   * holder happens to fall on.
   *
   * Grid only, and Minting only. The table is the ledger view and keeps the
   * order it was sorted by — a row that jumped the queue there would carry
   * nothing on it to explain why it had.
   */
  const { rows: ordered, fresh } = useMemo(() => {
    if (phase !== "minting" || view !== "grid") {
      return { rows: displayed, fresh: null as string | null };
    }

    /**
     * An unconfirmed mint outranks every confirmed one, because it is newer
     * than all of them by definition.
     *
     * The worker's crown is the last mint to CONFIRM, and confirming takes a
     * block. So a launch being minted this second loses the slot to one that
     * was minted ten minutes ago — the site knows about the newer activity
     * (it is already drawing amber rings for it) and was declining to act on
     * it. This is the same poll, read one step further.
     *
     * Most queued wins, not first seen. Arrival order would mean diffing one
     * mempool snapshot against the previous one, which only a tab that was
     * already open can do — two people would then see different kings. Depth
     * is stateless, so everyone polling the same mempool agrees.
     *
     * Only rows this section can actually draw are eligible: the page it is
     * showing, plus the worker's crown, which is usually not among them. An
     * asset minting hard while sitting on page three is simply not promoted
     * — no request is made to go and fetch it, which is what keeps this free.
     */
    const candidates = king ? [king, ...displayed] : displayed;
    let live: SectionRow | null = null;
    let liveN = 0;
    for (const r of candidates) {
      const n = pendingMints.get(r.fm.asset) ?? 0;
      if (n > liveN) {
        live = r;
        liveN = n;
      }
    }

    const holder = live ?? king;
    if (!holder) return { rows: displayed, fresh: null as string | null };
    // Matched on tx_hash, not on the object: the crown arrives as its own row
    // from its own statement, so it is never the same object as the copy on
    // the page even when it is the same launch.
    const rest = displayed.filter((r) => r.fm.tx_hash !== holder.fm.tx_hash);
    return { rows: [holder, ...rest], fresh: holder.fm.asset as string | null };
  }, [displayed, phase, view, king, pendingMints]);

  if (total === 0 && !empty) return null;

  const canTabulate = TABULAR.has(phase);
  // Keep the controls visible when this filter itself produces the empty
  // state. Otherwise a wallet that has minted every live launch would check
  // the box and immediately lose the only way to uncheck it.
  const showControls = total > 0 || hideMinted;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-baseline gap-2 text-xl font-bold">
          {title}
          {total > 0 && (
            <span className="text-sm font-medium text-gray-400 tabular-nums">
              {commas(total)}
            </span>
          )}
        </h2>

        {showControls && (
          <div className="flex shrink-0 items-center gap-2">
            {walletAddress && phase === "minting" && (
              <label className="hidden cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 sm:flex">
                <input
                  type="checkbox"
                  checked={hideMinted}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setHideMintedBy(checked ? walletAddress : null);
                    setPage(0);
                    // The unfiltered total is already known from the initial
                    // server render. Restore it immediately on uncheck rather
                    // than leaving the filtered count beside unfiltered rows.
                    if (!checked) setKnownTotal(initial.total);
                  }}
                  className="size-3.5 accent-purple-600"
                />
                <span>Hide minted</span>
              </label>
            )}

            <SortMenu
              label={`Sort ${title}`}
              options={options}
              value={sortId}
              onChange={(id) => {
                setSortId(id);
                setPage(0);
              }}
            />

            {canTabulate && (
              <div className="flex items-center rounded-full border border-gray-200 bg-white p-0.5">
                {(["grid", "table"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    aria-label={v === "grid" ? "Grid view" : "Table view"}
                    // No page reset: a page is the same launches either way
                    // now that the two views share one page size, so toggling
                    // keeps your place instead of throwing you back to the top.
                    onClick={() => onView(v)}
                    className={`rounded-full p-1.5 transition-colors ${
                      view === v ? "bg-gray-900 text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    }`}
                  >
                    <ViewIcon view={v} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {hideMinted ? "You’ve already minted every live launch." : empty}
        </p>
      ) : (
        // A fetch in flight dims the page it is replacing rather than clearing
        // it. Blanking would collapse the section's height and jump the page
        // under the cursor that just clicked, and the rows being replaced are
        // the best thing to show while their replacements are in the air.
        <div
          aria-busy={pending}
          className={pending ? "opacity-50 transition-opacity" : undefined}
        >
          {view === "table" && canTabulate ? (
            <LaunchTable
              rows={displayed}
              phase={phase}
              offset={current * perPage}
              height={height}
              xcpUsd={xcpUsd}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {ordered.map((r) => (
                <Card
                  key={r.fm.tx_hash}
                  row={r}
                  height={height}
                  xcpUsd={xcpUsd}
                  pending={pendingMints.get(r.fm.asset) ?? 0}
                  fresh={r.fm.asset === fresh}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Said plainly, because the alternative is the pager claiming to be on
          a page whose rows never arrived — the same class of quiet lie this
          whole change was about. */}
      {failed && (
        <p role="status" className="mt-3 text-center text-xs text-gray-500">
          Couldn&apos;t load page {current + 1}. Showing the last page that
          loaded.
        </p>
      )}

      {pages > 1 && <Pager page={current} pages={pages} onGo={setPage} />}
    </section>
  );
}

/**
 * The sort control: a dropdown showing the CURRENT sort.
 *
 * Pills were tried and don't survive four options — Minting now offers
 * Progress, Closing soonest, Minters and Newest, which as a segmented strip
 * is wider than the section heading beside it and wraps to its own line on a
 * phone. A dropdown costs the extra tap but stays one control at any width,
 * and labelling the trigger with the active option ("Sort: Closing soonest")
 * answers the "did that do anything?" question the popup would otherwise
 * invite, without keeping every choice on screen to do it.
 */
function SortMenu({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SortOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const active = options.find((o) => o.id === value) ?? options[0]!;

  return (
    <DM.Root>
      <DM.Trigger
        aria-label={label}
        className="flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-gray-300 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
      >
        <span className="text-gray-400">Sort:</span>
        {active.label}
        {/* Chevron, drawn rather than shipped as an icon dependency. */}
        <svg viewBox="0 0 16 16" className="size-3 text-gray-400" aria-hidden="true">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={6}
          className="modal-pop z-50 w-44 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg"
        >
          {options.map((o) => (
            <DM.Item
              key={o.id}
              onSelect={() => onChange(o.id)}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm font-medium outline-none data-[highlighted]:bg-gray-100 ${
                o.id === value ? "text-gray-900" : "text-gray-600"
              }`}
            >
              {o.label}
              {o.id === value && (
                <svg viewBox="0 0 16 16" className="size-3.5 text-purple-600" aria-hidden="true">
                  <path
                    d="M3 8.5l3.5 3.5L13 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/**
 * Numbered pages rather than infinite scroll: these sections are ranked, so
 * "page 3 of market cap" is a place someone can mean to be and come back to.
 */
function Pager({
  page,
  pages,
  onGo,
}: {
  page: number;
  pages: number;
  onGo: (p: number) => void;
}) {
  // First, last, and a window around the cursor; gaps collapse to an ellipsis
  // so a hundred pages still fits on one line.
  const nums = new Set<number>([0, pages - 1, page, page - 1, page + 1]);
  const list = [...nums].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);

  const btn = "min-w-8 rounded-lg px-2 py-1 text-xs font-medium transition-colors";
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-center gap-1">
      <button
        type="button"
        onClick={() => onGo(page - 1)}
        disabled={page === 0}
        className={`${btn} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent`}
      >
        ‹
      </button>
      {list.map((n, i) => (
        <span key={n} className="flex items-center gap-1">
          {i > 0 && n - list[i - 1]! > 1 && <span className="px-1 text-xs text-gray-300">…</span>}
          <button
            type="button"
            onClick={() => onGo(n)}
            aria-current={n === page ? "page" : undefined}
            className={`${btn} tabular-nums ${
              n === page ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {n + 1}
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => onGo(page + 1)}
        disabled={page >= pages - 1}
        className={`${btn} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent`}
      >
        ›
      </button>
    </nav>
  );
}

/** Full eight places. These prices sit far below 1 XCP, so the usual two or
 *  four decimals would round most of them to the same number. */
const priceLabel = (xcpPrice: number) =>
  xcpPrice > 0
    ? xcpPrice.toLocaleString("en-US", { minimumFractionDigits: 8, maximumFractionDigits: 8 })
    : "—";

const age = (announceBlock: number, height: number) =>
  announceBlock > 0 ? blocksEta(height - announceBlock).replace("~", "") : "—";

/**
 * The comparison view. Columns differ by phase because the phases are not
 * comparable on the same axes — a minting launch has no price and a graduated
 * one has no progress left to make.
 */
function LaunchTable({
  rows,
  phase,
  offset,
  height,
  xcpUsd,
}: {
  rows: SectionRow[];
  phase: LaunchPhase;
  offset: number;
  height: number;
  xcpUsd: number | null;
}) {
  const graduated = phase === "graduated";
  const scheduled = phase === "scheduled";
  // Scheduled has no progress and no raise — nothing has been minted — so it
  // lines up the only three facts it actually has rather than padding the row
  // with columns of zero.
  const head = graduated
    ? ["Market cap", "Price", "Graduated", "Holders"]
    : scheduled
      ? ["Opens", "Closes", "Announced"]
      : ["Progress", "Raised", "Minters", "Closes"];

  return (
    // Its own scroller: a wide table must never make the page scroll sideways.
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[38rem] text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th scope="col" className={`px-3 py-2.5 text-left ${LABEL}`}>
              Token
            </th>
            {head.map((h) => (
              <th key={h} scope="col" className={`px-3 py-2.5 text-right ${LABEL}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const deadline = r.fm.soft_cap_deadline_block || r.fm.end_block;
            return (
              <tr key={r.fm.tx_hash} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  <Link href={`/${r.fm.asset}`} className="flex min-w-0 items-center gap-2.5">
                    <span className="w-5 shrink-0 text-xs text-gray-400 tabular-nums">
                      {offset + i + 1}
                    </span>
                    <TokenImage
                      asset={r.fm.asset}
                      className="size-7 shrink-0 rounded-lg bg-gray-100 object-cover"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-gray-900">
                        {r.fm.asset}
                      </span>
                      <span className="block truncate text-[11px] text-gray-400">
                        by {shortAddress(r.fm.source)}
                      </span>
                    </span>
                  </Link>
                </td>
                {graduated ? (
                  <>
                    <Cell>
                      {r.marketCapXcp > 0
                        ? xcpUsd
                          ? usd(r.marketCapXcp * xcpUsd)
                          : `${compact(r.marketCapXcp)} XCP`
                        : "—"}
                    </Cell>
                    <Cell>{priceLabel(r.priceXcp)}</Cell>
                    <Cell>{age(r.lastMintBlock ?? r.announceBlock, height)}</Cell>
                    <Cell>{holderText(r.holders)}</Cell>
                  </>
                ) : scheduled ? (
                  <>
                    <Cell>{blocksEta(r.fm.start_block - height)}</Cell>
                    <Cell>{deadline > 0 ? blocksEta(deadline - height) : "—"}</Cell>
                    <Cell>{age(r.announceBlock, height)}</Cell>
                  </>
                ) : (
                  <>
                    <Cell>{(r.progress * 100).toFixed(1)}%</Cell>
                    <Cell>{compact(fromSats(r.fm.paid_quantity ?? 0))} XCP</Cell>
                    <Cell>{minterText(r.minters)}</Cell>
                    <Cell>{deadline > 0 ? blocksEta(deadline - height) : "—"}</Cell>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Grid and table, drawn rather than shipped as an icon dependency — the same
 *  approach the header's burger takes. The labels live in aria-label, so the
 *  control stays named for a screen reader. */
function ViewIcon({ view }: { view: View }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      {view === "grid" ? (
        // Four panes.
        <g fill="currentColor">
          <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" />
          <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" />
          <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" />
          <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" />
        </g>
      ) : (
        // Stacked rows, each with a leading cell — a list of records rather
        // than plain text lines, which would read as a paragraph icon.
        <g fill="currentColor">
          <rect x="1.5" y="2.5" width="3" height="2.5" rx="1" />
          <rect x="6" y="2.5" width="8.5" height="2.5" rx="1" />
          <rect x="1.5" y="6.75" width="3" height="2.5" rx="1" />
          <rect x="6" y="6.75" width="8.5" height="2.5" rx="1" />
          <rect x="1.5" y="11" width="3" height="2.5" rx="1" />
          <rect x="6" y="11" width="8.5" height="2.5" rx="1" />
        </g>
      )}
    </svg>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700">
      {children}
    </td>
  );
}

/**
 * The launch card.
 *
 * The identity rides the art — name and the phase's headline number over a
 * bottom gradient — because the art IS the card and pushing the name below it
 * turns a picture into a list row. Everything that can't be read over a busy
 * image drops to a quiet footer instead: one fact on the left, a time on the
 * right.
 *
 * Every line has to say something the others don't. The chip carries the
 * phase, so the footer carries time; the bar carries how much is minted, so
 * nothing restates it in words; the creator's address is the same shape on
 * every card and told a browser nothing, so it is gone.
 */
function Card({
  row,
  height,
  xcpUsd,
  pending,
  fresh,
}: {
  row: SectionRow;
  height: number;
  xcpUsd: number | null;
  /** Unconfirmed mints queued for this asset right now. */
  pending: number;
  /** This is the section's front slot — see the pin in Section. */
  fresh: boolean;
}) {
  const { fm, phase, conforming } = row;
  const deadline = fm.soft_cap_deadline_block || fm.end_block;
  const launchPriceXcp = ratio(fm.price, fm.quantity_by_price);
  const performance =
    phase === "graduated" && row.priceXcp > 0 && launchPriceXcp > 0
      ? ((row.priceXcp / launchPriceXcp) - 1) * 100
      : null;
  const performanceLabel =
    performance !== null && Number.isFinite(performance)
      ? `${performance > 0 ? "+" : ""}${performance.toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        })}%`
      : null;

  const chip =
    phase === "scheduled" ? (
      <Chip tone="dark">Upcoming</Chip>
    ) : phase === "minting" ? (
      <Chip tone="blue">Minting</Chip>
    ) : null;

  const headline =
    phase === "graduated"
      ? row.marketCapXcp > 0
        ? xcpUsd
          ? usd(row.marketCapXcp * xcpUsd)
          : `${compact(row.marketCapXcp)} XCP`
        : undefined
      : phase === "minting"
        ? `${(row.progress * 100).toFixed(1)}%`
        : undefined;

  // Bottom-left. Participation for the phases that have it: XCP-69 caps one
  // address at 1M of a 69M soft cap, so a launch needs 69 distinct minters to
  // close at all, which no other line on the card can tell you.
  //
  // 69 is a FLOOR, not a target. Anyone minting less than the per-address
  // maximum pushes the real count above it — a launch of 0.1% mints needs 690
  // people — so once the threshold is met "of 69" stops describing a goal and
  // starts reading like a cap that has been exceeded. Past it, the count
  // stands on its own.
  //
  // A null count is "not counted", and the one thing it must not become is 0:
  // "of 69" turns an unknown into a claim that nobody has joined, which the
  // progress bar directly above it can be busy disproving. The label stays so
  // the dash is legible as a missing number rather than a missing line.
  const minters = row.minters;
  const fact =
    phase === "minting"
      ? minters === null
        ? "— minters"
        : minters >= XCP69_MIN_PARTICIPANTS
          ? `${commas(minters)} minters`
          : `${commas(minters)} of ${XCP69_MIN_PARTICIPANTS} minters`
      : phase === "graduated"
        ? row.holders === null
          ? "— holders"
          : `${commas(row.holders)} holder${row.holders === 1 ? "" : "s"}`
        : `Opens at Block ${fm.start_block.toLocaleString()}`;

  // Bottom-right, always a time — the one axis every phase shares, pointing
  // backwards for the finished and forwards for the rest.
  const when =
    phase === "graduated"
      ? (row.lastMintBlock ?? row.announceBlock) > 0
        ? `${age(row.lastMintBlock ?? row.announceBlock, height)} ago`
        : ""
      : phase === "minting"
        ? deadline > 0
          ? `${blocksEta(deadline - height)} left`
          : ""
        : blocksEta(fm.start_block - height);

  /**
   * How long the crown has been worn, as the badge says it.
   *
   * `age` reports "now" for the block currently being built, where "now ago"
   * would be nonsense — so that case gets its own wording rather than a
   * template that only reads correctly for the other values.
   */
  /**
   * How long the crown has been worn, as the badge says it.
   *
   * Unconfirmed mints make it "just now" whatever the chain says, because
   * that is what is true: this card holds the slot for a mint happening right
   * now, and lastMintBlock describes the previous one that CONFIRMED. Dating
   * the badge from that would have a launch being minted this second wearing
   * a crown that says 20m ago.
   *
   * `age` also reports "now" for the block currently being built, where "now
   * ago" would be nonsense — so both cases land on the same wording.
   */
  const since = fresh && row.lastMintBlock ? age(row.lastMintBlock, height) : null;
  const mintedAgo =
    fresh && pending > 0
      ? "just now"
      : since === null || since === "—"
        ? null
        : since === "now"
          ? "just now"
          : `${since} ago`;

  return (
    <Link
      href={`/${fm.asset}`}
      // The holographic border is the graduated mark and nothing else. Worn
      // by every conforming launch it said only "this one conforms" — which is
      // true of every card on the page, since non-conforming launches are not
      // listed at all — so it distinguished nothing. Reserved for the finished,
      // it means something at a glance.
      //
      // Below it, two rings that mean two different things, in the order they
      // take precedence:
      //
      //   green  — this launch is wearing the crown. Exactly one card, ever.
      //   amber  — this launch has mints waiting in the mempool. Any number of
      //            cards, and gone the moment they confirm.
      //
      // Amber for pending because amber is ALREADY what the mempool looks like
      // here: the dot on the address line, and the chip in the header. A card
      // with unconfirmed mints now says so at the distance the grid is read
      // from, not just in the corner of one line. Green is left for the crown
      // — free to use because graduated is marked by the holographic border
      // and never by a green one, so the two cannot be confused.
      //
      // The crown wins when a card is both, which is common: the launch that
      // minted most recently is often the one still being minted.
      //
      // Rings rather than thicker borders. A border that changes WIDTH changes
      // the card's box, so one card growing a pixel would nudge every card in
      // its grid row. A ring is painted outside the box and moves nothing.
      className={`group block overflow-hidden rounded-xl bg-white shadow-sm transition-shadow hover:shadow-md ${
        conforming && phase === "graduated"
          ? "holo-border"
          : fresh
            ? "border border-green-500 ring-2 ring-green-100"
            : pending > 0
              ? "border border-amber-400 ring-2 ring-amber-100"
              : "border border-gray-200"
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-gray-100">
        <TokenImage
          asset={fm.asset}
          large
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {chip && <div className="absolute left-2 top-2">{chip}</div>}
        {performanceLabel && (
          <div className="absolute right-2 top-2">
            <Chip tone={performance !== null && performance >= 0 ? "green" : "dark"}>
              <span title="Percent change">{performanceLabel}</span>
            </Chip>
          </div>
        )}
        {/* Top-right, opposite the phase chip: a crown, and how long it has
            worn it.

            The crown does the work a word could not. Four wordings were tried
            and each failed the same test — a reader seeing this card ahead of
            cards with more progress wants to know WHY, and "Fresh Mint",
            "Minting now" and "Last mint" all named the state instead. A crown
            is read as "this one won" before any text is, which at minimum says
            the position is deliberate rather than a bug.

            The time says what it won. It teaches the rule without stating it:
            see 4m here and 39h on nothing else, and the ordering explains
            itself. It also stays honest when the site is quiet, where a badge
            claiming freshness would not — "3h ago" is the true answer and a
            useful one.

            "Minted" is deliberately absent. This card is under a heading that
            says Minting, wearing a chip that says Minting; a third Minting
            would be the redundancy that killed the second wording. */}
        {fresh && (
          <div className="absolute right-2 top-2">
            {/* The Chip component itself, not a span dressed to look like one.
                The first attempt hand-rolled the same padding and text size and
                still sat wrong beside the phase chip, because it added `flex` —
                which takes the badge out of inline layout and gives it a
                different height and baseline from the thing it is supposed to
                match. Sharing the component is what makes them the same size
                rather than nearly. */}
            <Chip tone="green">
              <span
                title={`Wearing the crown: minted more recently than anything else still minting${
                  mintedAgo ? ` — ${mintedAgo}` : ""
                }`}
              >
                <span aria-hidden>👑</span> {mintedAgo}
              </span>
            </Chip>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-3 pt-10">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-lg font-bold text-white">
              {fm.asset_longname ?? fm.asset}
            </span>
            {headline && (
              <span className="shrink-0 text-sm font-semibold text-white/90 tabular-nums">
                {headline}
              </span>
            )}
          </div>
        </div>
        {phase === "minting" && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/25">
            <div
              // Matches the ring, so the card reads as one object rather than
              // a purple bar with an unrelated coloured edge. Purple is the
              // site accent and stays the resting state — the two other
              // colours only appear when the ring is already saying the same
              // thing, and mean exactly what it means there.
              className={`h-full ${
                fresh ? "bg-green-500" : pending > 0 ? "bg-amber-400" : "bg-purple-500"
              }`}
              style={{ width: `${Math.min(100, saleProgress(fm) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="space-y-1 px-3 py-2.5 text-[11px] text-gray-500">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate tabular-nums">{fact}</span>
          <span className="shrink-0 tabular-nums">{when}</span>
        </div>
        {/* The creator, on its own line. It does not help rank one launch
            against another — which is why it is not on the row above with the
            facts that do — but it is the only thing on the card that says who
            is behind it, and an address in mono reads as an address.

            The pending count shares the line because it is the same kind of
            fact: not a measure to rank the launch by, just something true
            about it this second. Absent at zero, like the header chip it
            borrows the dot from — a counter that reads 0 almost always is a
            counter people stop reading.

            On EVERY card that has one, the pinned card included. These read
            across the grid rather than on one card: twenty mints in the
            mempool and this line is where they went, visible in one scan of
            the homepage. Suppressing it on the pinned card to avoid repeating
            the badge put the hole in that scan exactly where the traffic was
            heaviest — the busiest launch on the page became the one card not
            reporting its share. The badge answers "why is this first"; this
            answers "where is everything going", and they are not the same
            question. */}
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[10px] text-gray-400">
            {shortAddress(fm.source)}
          </span>
          {pending > 0 && (
            <span
              title={`${pending} unconfirmed transaction${pending === 1 ? "" : "s"} in the mempool`}
              className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-amber-700"
            >
              <PendingDot />
              <span className="tabular-nums">
                {pending} tx{pending === 1 ? "" : "s"}
              </span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "dark" | "blue" | "green";
  children: React.ReactNode;
}) {
  const tones = {
    dark: "bg-black/60 text-white",
    blue: "bg-blue-600/80 text-white",
    green: "bg-green-600/80 text-white",
  } as const;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium backdrop-blur-sm ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
