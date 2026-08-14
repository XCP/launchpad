"use client";

import Link from "next/link";
import { DropdownMenu as DM } from "radix-ui";
import { useMemo, useState } from "react";
import { TokenImage } from "@/components/token-image";
import { useWallet } from "@/lib/wallet/wallet-context";
import { PREVIEW_ADDRESS } from "@/lib/constants";
import { LABEL } from "@/components/ui/tokens";
import { blocksEta, commas, compact, fromSats, shortAddress, usd } from "@/lib/format";
import {
  type Fairminter,
  type LaunchPhase,
  saleProgress,
  XCP69_MIN_PARTICIPANTS,
} from "@/lib/xcp69";

/** One launch, with the derived numbers a section needs to sort and tabulate
 *  it. Computed on the server so every row arrives comparable. */
export interface SectionRow {
  fm: Fairminter;
  phase: LaunchPhase;
  conforming: boolean;
  /** XCP per whole token × supply. Zero until a pool exists. */
  marketCapXcp: number;
  /** XCP per whole token. Zero until a pool exists. */
  priceXcp: number;
  /** Distinct addresses that have minted. */
  minters: number;
  /** Block it was announced in; 0 when unresolved. */
  announceBlock: number;
  /** 0–1 toward the soft cap. */
  progress: number;
}

type View = "grid" | "table";

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
 * Each phase is judged by its own measure, so each gets its own sort menu
 * rather than one shared list where two thirds of the options are inert.
 * The first entry is the default, and matches the order apps/api already
 * returns the section in.
 */
const SORTS: Record<string, SortOption[]> = {
  graduated: [
    { id: "mcap", label: "Market cap", by: (a, b) => b.marketCapXcp - a.marketCapXcp },
    { id: "minters", label: "Minters", by: (a, b) => b.minters - a.minters },
    { id: "newest", label: "Newest", by: (a, b) => announced(b) - announced(a) },
  ],
  minting: [
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
    { id: "minters", label: "Minters", by: (a, b) => b.minters - a.minters },
    { id: "newest", label: "Newest", by: (a, b) => announced(b) - announced(a) },
  ],
  scheduled: [
    { id: "soonest", label: "Soonest", by: (a, b) => a.fm.start_block - b.fm.start_block },
    { id: "newest", label: "Newest", by: (a, b) => b.fm.start_block - a.fm.start_block },
  ],
};

/** Every section tabulates. Scheduled has less to line up than the others —
 *  no progress, no raise — but the toggle is one page-level choice, and a
 *  section that silently ignored it read as a broken control rather than as
 *  a section with nothing to show. */
const TABULAR = new Set(["graduated", "minting", "scheduled"]);

/**
 * How many a section shows before paging, by phase.
 *
 * Not one number: these sections answer different questions. Graduated is a
 * shortlist of what did well, so eight is a look rather than a catalogue.
 * Minting is the one people are actually shopping, so it gets the most room.
 * Both 24 and 12 divide evenly by 2, 3 and 4 — the grid's column counts — so
 * no breakpoint ends on a ragged half-row.
 */
const GRID_PER_PAGE: Record<string, number> = {
  graduated: 8,
  minting: 24,
  scheduled: 12,
};

/** Rows are far cheaper than cards, so a table page holds more of them. */
const TABLE_PER_PAGE = 25;

/**
 * Graduated cards, fabricated from the launches that DO exist.
 *
 * Nothing has graduated yet, so the section that leads the page is the one
 * nobody can look at. Reusing real rows — real art, real names — means the
 * preview shows what the layout will actually do rather than what it does with
 * invented placeholder art, which is the part that usually lies.
 */
function sampleGraduated(rows: SectionRow[], height: number): SectionRow[] {
  const seeds = rows.slice(0, 4);
  return seeds.map((r, i) => ({
    ...r,
    phase: "graduated" as LaunchPhase,
    // A spread of magnitudes, so the column shows how the numbers line up
    // rather than four of the same width — and DELIBERATELY out of step with
    // each other. Ranked the same way on every axis, the sample made all three
    // sorts return one order, which is indistinguishable from a sort that
    // does nothing. Sample data has to be able to demonstrate the control.
    marketCapXcp: [41000, 12400, 3900, 820][i] ?? 500,
    priceXcp: [0.00041, 0.000124, 0.000039, 0.0000082][i] ?? 0.000005,
    minters: [97, 412, 71, 288][i] ?? 69,
    announceBlock: height - [8800, 430, 4100, 2600][i]!,
    progress: 1,
  }));
}

export function LaunchSections({
  rows,
  totals,
  height,
  xcpUsd,
}: {
  rows: SectionRow[];
  /** Real totals per phase, which can exceed what was sent to the page. */
  totals?: { graduated: number; minting: number; scheduled: number };
  height: number;
  xcpUsd: number | null;
}) {
  // One choice for the whole page: picking Table in one section and finding
  // the next still in cards reads as a bug, not a setting. Sections that
  // can't tabulate simply ignore it.
  const [view, setView] = useState<View>("grid");
  const [preview, setPreview] = useState(false);
  // Same gate as the asset and profile previews: a review tool for the owner,
  // not a control every visitor gets offered.
  const { address } = useWallet();
  const canPreview = address === PREVIEW_ADDRESS;
  const graduated = useMemo(
    () =>
      preview
        ? sampleGraduated(rows, height)
        : rows.filter((r) => r.phase === "graduated"),
    [preview, rows, height],
  );
  const of = (phase: LaunchPhase) =>
    phase === "graduated" ? graduated : rows.filter((r) => r.phase === phase);
  return (
    <div className="space-y-10">
      {/* Graduated leads by position only. The holographic border on its cards
          already marks them out, and a tinted panel around them said the same
          thing a second time. */}
      <Section
        phase="graduated"
        title="Graduated"
        empty=""
        rows={of("graduated")}
        total={preview ? graduated.length : totals?.graduated}
        height={height}
        xcpUsd={xcpUsd}
        view={view}
        onView={setView}
      />

      <Section
        phase="minting"
        title="Minting"
        empty="No live launches. Start one — it sells out or everyone gets refunded."
        rows={of("minting")}
        total={totals?.minting}
        height={height}
        xcpUsd={xcpUsd}
        view={view}
        onView={setView}
      />

      <Section
        phase="scheduled"
        title="Scheduled"
        empty=""
        rows={of("scheduled")}
        total={totals?.scheduled}
        height={height}
        xcpUsd={xcpUsd}
        view={view}
        onView={setView}
      />

      {canPreview && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-gray-200 bg-white/95 px-1.5 py-1 text-[11px] font-medium shadow-lg backdrop-blur">
          <span className="px-1.5 text-gray-400">graduated</span>
          {(["live", "sample"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPreview(mode === "sample")}
              className={`rounded-full px-2 py-1 ${
                preview === (mode === "sample")
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {mode === "live" ? "live" : "sample data"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({
  phase,
  title,
  empty,
  rows,
  total,
  height,
  xcpUsd,
  view,
  onView,
}: {
  phase: LaunchPhase;
  title: string;
  empty: string;
  rows: SectionRow[];
  total?: number;
  height: number;
  xcpUsd: number | null;
  view: View;
  onView: (v: View) => void;
}) {
  const options = SORTS[phase] ?? SORTS.scheduled!;
  const [sortId, setSortId] = useState(options[0]!.id);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const by = (options.find((o) => o.id === sortId) ?? options[0]!).by;
    return [...rows].sort(by);
  }, [rows, options, sortId]);

  const perPage = view === "table" ? TABLE_PER_PAGE : (GRID_PER_PAGE[phase] ?? 12);
  const pages = Math.max(1, Math.ceil(sorted.length / perPage));
  // A control change can leave the cursor past the end; clamp on read rather
  // than resetting in an effect, which would flash the old page first.
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * perPage, current * perPage + perPage);

  if (rows.length === 0 && !empty) return null;

  const canTabulate = TABULAR.has(phase);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-baseline gap-2 text-xl font-bold">
          {title}
          {total !== undefined && total > 0 && (
            <span className="text-sm font-medium text-gray-400 tabular-nums">
              {commas(total)}
            </span>
          )}
        </h2>

        {rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
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
                    onClick={() => {
                      onView(v);
                      setPage(0);
                    }}
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
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {empty}
        </p>
      ) : view === "table" && canTabulate ? (
        <LaunchTable
          rows={shown}
          phase={phase}
          offset={current * perPage}
          height={height}
          xcpUsd={xcpUsd}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {shown.map((r) => (
            <Card key={r.fm.tx_hash} row={r} height={height} xcpUsd={xcpUsd} />
          ))}
        </div>
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
    ? ["Market cap", "Price", "Age", "Minters"]
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
                    <Cell>{age(r.announceBlock, height)}</Cell>
                    <Cell>{commas(r.minters)}</Cell>
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
                    <Cell>{commas(r.minters)}</Cell>
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
}: {
  row: SectionRow;
  height: number;
  xcpUsd: number | null;
}) {
  const { fm, phase, conforming } = row;
  const deadline = fm.soft_cap_deadline_block || fm.end_block;

  const chip =
    phase === "graduated" ? (
      <Chip tone="green">Graduated</Chip>
    ) : phase === "scheduled" ? (
      <Chip tone="dark">Upcoming</Chip>
    ) : (
      <Chip tone="blue">Minting</Chip>
    );

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
  const fact =
    phase === "minting"
      ? row.minters >= XCP69_MIN_PARTICIPANTS
        ? `${commas(row.minters)} minters`
        : `${commas(row.minters)} of ${XCP69_MIN_PARTICIPANTS} minters`
      : phase === "graduated"
        ? `${commas(row.minters)} minter${row.minters === 1 ? "" : "s"}`
        : `Opens at Block ${fm.start_block.toLocaleString()}`;

  // Bottom-right, always a time — the one axis every phase shares, pointing
  // backwards for the finished and forwards for the rest.
  const when =
    phase === "graduated"
      ? row.announceBlock > 0
        ? `${age(row.announceBlock, height)} ago`
        : ""
      : phase === "minting"
        ? deadline > 0
          ? `${blocksEta(deadline - height)} left`
          : ""
        : blocksEta(fm.start_block - height);

  return (
    <Link
      href={`/${fm.asset}`}
      // The holographic border is the graduated mark and nothing else. Worn
      // by every conforming launch it said only "this one conforms" — which is
      // true of every card on the page, since non-conforming launches are not
      // listed at all — so it distinguished nothing. Reserved for the finished,
      // it means something at a glance.
      className={`group block overflow-hidden rounded-xl bg-white shadow-sm transition-shadow hover:shadow-md ${
        conforming && phase === "graduated" ? "holo-border" : "border border-gray-200"
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-gray-100">
        <TokenImage
          asset={fm.asset}
          large
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute left-2 top-2">{chip}</div>
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
              className="h-full bg-purple-500"
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
            is behind it, and an address in mono reads as an address. */}
        <div className="truncate font-mono text-[10px] text-gray-400">
          {shortAddress(fm.source)}
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
