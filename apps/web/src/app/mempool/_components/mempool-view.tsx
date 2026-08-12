"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TokenImage } from "@/components/token-image";
import { Tabs, TabsContent, SegmentedList, SegmentedTrigger } from "@/components/ui/tabs";
import { LABEL, FOCUS } from "@/components/ui/tokens";
import { useMempool } from "@/hooks/use-mempool";
import { commas, fromSats, shortAddress, tokenQty } from "@/lib/format";
import { groupMintsByAddress, mempoolTotals, summarize } from "@/lib/mempool";

/** The page is being watched, so it polls hard. */
const REFRESH_MS = 10_000;

/** Smashable without hammering Counterparty: the button always responds, but
 *  a second fetch inside this window is refused rather than queued. */
const MANUAL_REFRESH_DEBOUNCE_MS = 10_000;

export function MempoolView() {
  const { fairminters, mints, fetchedAt, isLoading, refresh } = useMempool(REFRESH_MS);

  const groups = groupMintsByAddress(mints);
  const totals = mempoolTotals(fairminters.length, groups);

  return (
    <div className="space-y-4">
      <Freshness fetchedAt={fetchedAt} onRefresh={refresh} />

      {(isLoading || totals.transactions > 0) && (
        <p className="text-sm text-gray-700">
          {isLoading ? "Reading the mempool…" : summarize(totals)}
        </p>
      )}

      <Tabs defaultValue="fairminters">
        {/* Two tabs stretched across a 48rem page read as a split view rather
            than a control, so they size to their labels instead. */}
        <SegmentedList className="w-fit">
          <SegmentedTrigger value="fairminters" grow={false}>
            Fairminters {totals.fairminters > 0 && `(${totals.fairminters})`}
          </SegmentedTrigger>
          <SegmentedTrigger value="mints" grow={false}>
            Mints {totals.mints > 0 && `(${totals.mints})`}
          </SegmentedTrigger>
        </SegmentedList>

        <TabsContent value="fairminters" className="mt-4">
          {fairminters.length === 0 ? (
            <Empty>
              No launches queued. Every XCP-69 launch broadcast so far has
              confirmed.
            </Empty>
          ) : (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
              {fairminters.map((fm) => (
                <li key={fm.tx_hash} className="flex items-center gap-3 p-3">
                  <TokenImage
                    asset={fm.asset}
                    className="size-10 shrink-0 rounded-lg object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-gray-900">{fm.asset}</div>
                    <Link
                      href={`/profile/${fm.source}`}
                      className="font-mono text-xs text-gray-500 hover:text-purple-700"
                    >
                      {shortAddress(fm.source)}
                    </Link>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs font-medium text-gray-900 tabular-nums">
                      opens {commas(fm.start_block)}
                    </div>
                    <div className="text-[11px] text-gray-400">unconfirmed</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="mints" className="mt-4">
          {groups.length === 0 ? (
            <Empty>Nothing queued — every mint so far has confirmed.</Empty>
          ) : (
            /* Horizontal scroll rather than dropped columns: every number here
               is the point of the table, so none of them is the one to hide. */
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left">
                    <Th>Minter</Th>
                    <Th>Asset</Th>
                    <Th right>Mints</Th>
                    <Th right>Supply</Th>
                    <Th right>XCP</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {groups.map((g) => (
                    <tr key={g.source}>
                      <td className="whitespace-nowrap p-3">
                        <Link
                          href={`/profile/${g.source}`}
                          className="font-mono text-xs text-gray-600 hover:text-purple-700"
                        >
                          {shortAddress(g.source)}
                        </Link>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {g.assets.map((a) => (
                            <Link
                              key={a}
                              href={`/${a}`}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
                            >
                              {a}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 text-right tabular-nums">{commas(g.mints)}</td>
                      <td className="p-3 text-right tabular-nums">
                        {commas(tokenQty(g.tokensRaw, g.divisible))}
                      </td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        {commas(fromSats(g.xcpRaw))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * The freshness strip.
 *
 * A stale mempool page is worse than no mempool page, so the age is always on
 * screen rather than implied by a spinner that only appears mid-fetch. The
 * label ticks every second: a number that visibly moves is the cheapest proof
 * a page is alive.
 */
function Freshness({
  fetchedAt,
  onRefresh,
}: {
  fetchedAt: number | null;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [lastManual, setLastManual] = useState(0);

  // One timer drives both the age label and the button's cooldown, so they
  // can never disagree about what time it is.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const cooling = now - lastManual < MANUAL_REFRESH_DEBOUNCE_MS;
  const seconds = fetchedAt === null ? null : Math.max(0, Math.round((now - fetchedAt) / 1000));

  return (
    <div className="flex items-center justify-between gap-3">
      <span className={LABEL}>
        {seconds === null
          ? "loading"
          : seconds < 2
            ? "updated just now"
            : `updated ${seconds}s ago`}
      </span>
      <button
        type="button"
        onClick={() => {
          if (cooling) return;
          setLastManual(Date.now());
          onRefresh();
        }}
        aria-disabled={cooling}
        title={cooling ? "Just refreshed — give it a moment" : "Refresh now"}
        className={`rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium transition-colors ${FOCUS} ${
          cooling
            ? "cursor-default text-gray-300"
            : "text-gray-700 hover:border-gray-300 hover:text-gray-900"
        }`}
      >
        Refresh
      </button>
    </div>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`p-3 font-medium text-gray-500 ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
      {children}
    </p>
  );
}
