"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { TokenImage } from "@/components/token-image";
import { fetchLaunchPage } from "@/lib/api/launchpad-api";
import { blocksEta, commas, compact, fromSats, shortAddress } from "@/lib/format";
import { type LaunchPage, PER_PAGE, type SectionRow, toSectionRow } from "@/lib/launch-row";

const REFRESH_MS = 60_000;

export function GraveyardList({
  initial,
  initialAvailable,
  height,
}: {
  initial: LaunchPage;
  initialAvailable: boolean;
  height: number;
}) {
  const perPage = PER_PAGE.refunded;
  const [page, setPage] = useState(0);
  const [knownTotal, setKnownTotal] = useState(initial.total);
  const pages = Math.max(1, Math.ceil(knownTotal / perPage));
  const current = Math.min(page, pages - 1);

  const { data, error, isLoading } = useSWR<LaunchPage>(
    ["graveyard", current, perPage],
    async () => {
      const result = await fetchLaunchPage(
        "refunded",
        "failed",
        perPage,
        current * perPage,
      );
      if (!result) throw new Error("graveyard unavailable");
      return {
        rows: result.rows.map(toSectionRow),
        total: result.total,
        king: null,
      };
    },
    {
      fallbackData: initialAvailable && current === 0 ? initial : undefined,
      revalidateOnMount: !initialAvailable,
      refreshInterval: REFRESH_MS,
      revalidateOnFocus: true,
      keepPreviousData: true,
      onSuccess: (result) => setKnownTotal(result.total),
    },
  );

  const shown = data ?? (initialAvailable ? initial : null);
  const total = data?.total ?? knownTotal;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="max-w-2xl">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-2xl font-bold">Graveyard</h1>
          {total > 0 && (
            <span className="text-sm font-medium tabular-nums text-gray-400 dark:text-gray-500">
              {commas(total)}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
          XCP-69 launches that closed below their soft cap. Their temporary
          token supply was destroyed and every participant&apos;s escrowed XCP
          was repaid by the protocol.
        </p>
      </header>

      {!shown ? (
        <p
          role="status"
          className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          {isLoading ? "Opening the graveyard…" : "The graveyard is unavailable right now."}
        </p>
      ) : shown.total === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Nothing here. That&apos;s good.
        </p>
      ) : (
        <div
          aria-busy={isLoading}
          className={`grid grid-cols-2 gap-3 transition-opacity sm:gap-4 md:grid-cols-3 lg:grid-cols-4 ${
            isLoading ? "opacity-50" : ""
          }`}
        >
          {shown.rows.map((row) => (
            <GraveyardCard key={row.fm.tx_hash} row={row} height={height} />
          ))}
        </div>
      )}

      {error && shown && (
        <p role="status" className="text-center text-xs text-gray-500 dark:text-gray-400">
          Couldn&apos;t refresh this page. Showing the last version that loaded.
        </p>
      )}

      {shown && totalPages > 1 && (
        <Pager page={Math.min(current, totalPages - 1)} pages={totalPages} onGo={setPage} />
      )}
    </div>
  );
}

function GraveyardCard({ row, height }: { row: SectionRow; height: number }) {
  const { fm } = row;
  const closedBlock = fm.soft_cap_deadline_block || fm.end_block;
  const elapsed = closedBlock > 0 && height > 0
    ? blocksEta(height - closedBlock).replace("~", "")
    : "";
  const minters = row.minters === null
    ? "— minters"
    : `${commas(row.minters)} minter${row.minters === 1 ? "" : "s"}`;
  const refunded = fromSats(fm.paid_quantity ?? 0);

  return (
    <Link
      href={`/${fm.asset}`}
      className="group block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-800">
        <TokenImage
          asset={fm.asset}
          large
          className="size-full object-cover grayscale transition duration-300 group-hover:scale-105 group-hover:grayscale-0"
        />
        <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
          <span aria-hidden>💀</span> RIP
        </span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 pt-10">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-lg font-bold text-white">
              {fm.asset_longname ?? fm.asset}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-white/90">
              {(row.progress * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1 px-3 py-2.5 text-[11px] text-gray-500 dark:text-gray-400">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate tabular-nums">
            {refunded > 0 ? `${compact(refunded)} XCP repaid` : "No XCP committed"}
          </span>
          <span className="shrink-0 tabular-nums">{minters}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[10px] text-gray-400 dark:text-gray-500">
            {shortAddress(fm.source)}
          </span>
          <span className="shrink-0 tabular-nums">
            {elapsed ? `failed ${elapsed === "now" ? "now" : `${elapsed} ago`}` : "failed"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function Pager({
  page,
  pages,
  onGo,
}: {
  page: number;
  pages: number;
  onGo: (page: number) => void;
}) {
  const candidates = new Set([0, pages - 1, page - 1, page, page + 1]);
  const numbers = [...candidates]
    .filter((candidate) => candidate >= 0 && candidate < pages)
    .sort((a, b) => a - b);
  const button = "min-w-8 rounded-lg px-2 py-1 text-xs font-medium transition-colors";

  return (
    <nav aria-label="Graveyard pages" className="flex items-center justify-center gap-1">
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onGo(page - 1)}
        className={`${button} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800`}
      >
        ‹
      </button>
      {numbers.map((number, index) => (
        <span key={number} className="flex items-center gap-1">
          {index > 0 && number - numbers[index - 1]! > 1 && (
            <span className="px-1 text-xs text-gray-300 dark:text-gray-600">…</span>
          )}
          <button
            type="button"
            onClick={() => onGo(number)}
            aria-current={number === page ? "page" : undefined}
            className={`${button} tabular-nums ${
              number === page
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            }`}
          >
            {number + 1}
          </button>
        </span>
      ))}
      <button
        type="button"
        disabled={page >= pages - 1}
        onClick={() => onGo(page + 1)}
        className={`${button} text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-gray-800`}
      >
        ›
      </button>
    </nav>
  );
}
