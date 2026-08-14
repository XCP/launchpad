"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useDebounced } from "@/hooks/use-debounced";
import {
  fetchMinterEarnings,
  type MinterEarning,
} from "@/lib/api/launchpad-api";
import { commas, fromSats, shortAddress } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";
import { mintsEarned } from "@/lib/rewards";

const PER_PAGE = 25;

/**
 * The leaderboard, paged and searchable — because "top 25" stops being the
 * whole story the day the 26th minter shows up.
 *
 * Search is an exact-address lookup against the API, not a filter over the
 * loaded page: the address someone cares about is usually their own, pasted
 * whole, and it may live on page 40. Next/Prev instead of numbered pages —
 * the API doesn't count the whole board per request (D1 bills the scan), and
 * a full page implies a next one closely enough.
 */
export function EarnersTable({ initial }: { initial: MinterEarning[] }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const source = useDebounced(query.trim(), 300) || undefined;

  const { data } = useSWR(
    ["minter-earnings", source ?? "", source ? 0 : page],
    () => fetchMinterEarnings(PER_PAGE, source, source ? 0 : page * PER_PAGE),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      fallbackData: !source && page === 0 ? initial : undefined,
    },
  );
  const rows = data ?? [];

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(0);
        }}
        placeholder="Search by address"
        aria-label="Search minters by address"
        spellCheck={false}
        className="mt-4 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2 font-mono text-xs text-gray-700 outline-none placeholder:font-sans placeholder:text-sm placeholder:text-gray-400 focus:border-purple-400"
      />

      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          {source
            ? "No mints from that address. Search matches a full address exactly."
            : page > 0
              ? "Nothing past here — the board ends on the previous page."
              : "Nobody has minted yet. The first row here is available."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th scope="col" className={`px-4 py-2.5 ${LABEL}`}>
                  Minter
                </th>
                <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                  Mints
                </th>
                <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                  Launches
                </th>
                <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                  Committed
                </th>
                <th scope="col" className={`px-4 py-2.5 text-right ${LABEL}`}>
                  Earned
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((m, i) => (
                <tr key={m.source} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3">
                    {/* A searched row's rank is unknown without walking the
                        whole board, so it claims none. */}
                    <span className="mr-2 text-xs text-gray-400 tabular-nums">
                      {source ? "" : page * PER_PAGE + i + 1}
                    </span>
                    <Link
                      href={`/profile/${m.source}`}
                      className="font-mono text-xs text-gray-600 hover:text-purple-700"
                    >
                      {shortAddress(m.source)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {commas(m.mints)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                    {commas(m.launches)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                    {commas(fromSats(m.paid))} XCP
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-gray-900">
                    {commas(mintsEarned(m.mints))}
                    <span className="ml-1 text-[11px] font-normal text-gray-400">MINTS</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!source && (page > 0 || rows.length === PER_PAGE) && (
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>Page {page + 1}</span>
          <button
            type="button"
            disabled={rows.length < PER_PAGE}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-gray-200 px-3 py-2 font-medium text-gray-600 transition-colors hover:border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}
