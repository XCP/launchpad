"use client";

import { useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TokenImage } from "@/components/token-image";
import { blocksEta, commas, compact, shortAddress, usd } from "@/lib/format";
import { fetchSearchIndex } from "@/lib/api/launchpad-api";
import { type SearchRow, toSearchRow } from "@/lib/launch-row";

export type { SearchRow };

export type SearchPhase = "all" | "graduated" | "minting" | "scheduled";

const PHASES: { id: SearchPhase; label: string }[] = [
  { id: "all", label: "All" },
  { id: "graduated", label: "Graduated" },
  { id: "minting", label: "Minting" },
  { id: "scheduled", label: "Scheduled" },
];

/**
 * Each phase has one obvious ordering, so there is no sort control.
 *
 * A sort menu only earns its space when the choice is genuinely open, and here
 * it never was: nobody wants graduated launches by anything but market cap, or
 * scheduled ones by anything but which opens next. Offering the choice mostly
 * offered ways to make the list worse.
 *
 *  - all: market cap, then minters — the only two figures that mean the same
 *    thing in every phase, so a mixed list stays comparable.
 *  - graduated: market cap.
 *  - minting: progress toward the cap, fullest first.
 *  - scheduled: whichever opens next.
 */
const ORDER: Record<SearchPhase, (a: SearchRow, b: SearchRow) => number> = {
  all: (a, b) => b.marketCapXcp - a.marketCapXcp || b.minters - a.minters,
  graduated: (a, b) => b.marketCapXcp - a.marketCapXcp,
  minting: (a, b) => b.progress - a.progress,
  scheduled: (a, b) => a.startBlock - b.startBlock,
};

/**
 * The number shown on the right of every row.
 *
 * Filtered to one phase, it is that phase's own measure — market cap once a
 * launch has a market, progress while it is still filling, the opening block
 * before it starts. Across ALL phases it falls back to minters, the one figure
 * every launch has at every point in its life, because a column that changes
 * meaning row by row is a column nobody can compare down.
 */
function metric(row: SearchRow, phase: SearchPhase, height: number, xcpUsd: number | null): string {
  const shown = phase === "all" ? "minters" : row.phase;
  if (shown === "graduated") {
    if (row.marketCapXcp <= 0) return `${commas(row.minters)} minters`;
    return xcpUsd ? usd(row.marketCapXcp * xcpUsd) : `${compact(row.marketCapXcp)} XCP`;
  }
  if (shown === "minting") return `${(row.progress * 100).toFixed(1)}%`;
  if (shown === "scheduled") return `opens ${blocksEta(row.startBlock - height)}`;
  return `${commas(row.minters)} minter${row.minters === 1 ? "" : "s"}`;
}

/**
 * How well a row answers the query, lower being better.
 *
 * An exact asset beats a prefix beats a substring — typing "STAR" should put
 * STAR above STARMONEY above MYSTARS, which plain substring matching gets
 * wrong in all three positions. Only used while something is typed; with an
 * empty box the chosen sort orders the list on its own.
 */
function relevance(row: SearchRow, q: string): number {
  const asset = row.asset;
  const name = (row.name ?? "").toUpperCase();
  if (asset === q) return 0;
  if (asset.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (asset.includes(q)) return 3;
  if (name.includes(q)) return 4;
  return 5;
}

/**
 * The search panel.
 *
 * A dialog rather than a dropdown, because it is doing more than completing a
 * word: sorting and filtering need room, and a panel that owns the screen can
 * be driven entirely from the keyboard. Everything filters in memory, which is
 * instant and can never offer an asset that isn't there.
 *
 * What it filters is now the WHOLE conforming index, fetched the first time
 * the dialog opens. It used to be whatever the homepage had already sent
 * down, which quietly made search a search of the front page: once the
 * sections became paged that was three pages, and typing the exact ticker of
 * any launch outside them answered "nothing matches". Telling someone the
 * thing they named does not exist is a worse failure than a short list, and it
 * is the one failure a search box must not have.
 *
 * Fetched on open rather than with the page, so a visit that never searches
 * never pays for it. The in-memory filtering still has a ceiling — it is the
 * right call while the whole index fits in one payload — but the ceiling is
 * now the size of the index rather than the size of a page.
 */
export function LaunchSearch({
  height,
  xcpUsd,
}: {
  /** Chain tip, for turning a start block into "opens in". */
  height: number;
  xcpUsd: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("all");
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Once. A second open re-uses what the first fetched; the index is a minute
  // stale at worst, and re-fetching per open would spend a request to move a
  // percentage.
  const load = useCallback(() => {
    if (rows !== null || loading) return;
    setLoading(true);
    fetchSearchIndex()
      .then((res) => {
        if (res) setRows(res.map(toSearchRow));
      })
      .finally(() => setLoading(false));
  }, [rows, loading]);

  // Cmd/Ctrl-K from anywhere on the page, the convention for this control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        load();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    const pool = (rows ?? []).filter((r) => (phase === "all" ? true : r.phase === phase));
    // Typing still ranks by how well the name answers it — an exact asset
    // beats a prefix beats a substring — and only then by the chosen sort.
    const matched = q ? pool.filter((r) => relevance(r, q) < 5) : pool;
    const by = ORDER[phase];
    return [...matched].sort(
      (a, b) => (q ? relevance(a, q) - relevance(b, q) : 0) || by(a, b),
    );
  }, [rows, query, phase]);

  const go = (asset: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/${asset}`);
  };

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
    }`;

  return (
    <D.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <D.Trigger asChild>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full border border-gray-200 bg-white py-2 pl-3.5 pr-2 text-left text-sm text-gray-400 transition-colors hover:border-gray-300"
        >
          <svg aria-hidden viewBox="0 0 16 16" fill="none" className="size-4 shrink-0">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="min-w-0 flex-1 truncate">Search launches</span>
          <kbd className="hidden shrink-0 rounded border border-gray-200 px-1.5 py-0.5 font-sans text-[10px] text-gray-400 sm:block">
            ⌘K
          </kbd>
        </button>
      </D.Trigger>

      <D.Portal>
        <D.Overlay className="backdrop-fade fixed inset-0 z-50 bg-black/40" />
        <D.Content className="modal-pop fixed left-1/2 top-[8vh] z-50 flex max-h-[80vh] w-[min(94vw,40rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
          <D.Title className="sr-only">Search launches</D.Title>
          <D.Description className="sr-only">
            Find a launch by asset name, and sort or filter the results.
          </D.Description>

          <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5">
            <svg aria-hidden viewBox="0 0 16 16" fill="none" className="size-5 shrink-0 text-gray-400">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {/* Autofocus is correct here: the dialog exists to be typed into,
                and Radix returns focus to the trigger on close. */}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) go(results[0].asset);
              }}
              placeholder="Search asset name"
              aria-label="Search asset name"
              className="min-w-0 flex-1 bg-transparent text-base text-gray-900 outline-none placeholder:text-gray-400"
            />
          </div>

          <div className="flex items-center gap-1 border-b border-gray-100 px-4 py-2.5">
            {PHASES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPhase(p.id)}
                aria-pressed={phase === p.id}
                className={chip(phase === p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto p-2">
            {results.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-gray-500">
                {/* "Nothing matches" is a claim about the index, so it must
                    not be made before the index has arrived. */}
                {rows === null
                  ? "Loading launches…"
                  : query
                    ? `Nothing matches “${query}”.`
                    : "No launches in this phase yet."}
              </li>
            ) : (
              results.map((r) => (
                <li key={r.asset}>
                  <button
                    type="button"
                    onClick={() => go(r.asset)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <TokenImage
                      asset={r.asset}
                      className="size-9 shrink-0 rounded-lg bg-gray-100 object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {r.name ?? r.asset}
                      </span>
                      {/* The asset name is the identity — Counterparty has no
                          separate ticker — so repeating it here would spend the
                          line on nothing. Who made it and when is what a
                          stranger actually needs to tell two launches apart. */}
                      {/* Across ALL phases the second fact is the phase — it
                          is the only thing distinguishing two rows. Filtered to
                          one phase that word is already known, so the space
                          goes to age instead. A launch whose announcement
                          block hasn't been resolved yet simply omits it rather
                          than inventing one. */}
                      <span className="block truncate text-xs text-gray-500">
                        by {shortAddress(r.source)}
                        {phase === "all"
                          ? ` · ${r.phase}`
                          : r.announceBlock > 0
                            ? ` · ${blocksEta(height - r.announceBlock).replace("~", "")} old`
                            : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium tabular-nums text-gray-600">
                      {metric(r, phase, height, xcpUsd)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 text-xs text-gray-400">
            <span>
              {results.length} of {rows?.length ?? 0}
            </span>
            <span className="hidden sm:block">Enter opens the first result · Esc closes</span>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

