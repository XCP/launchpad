"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { LazyLink } from "@/components/lazy-link";
import { TokenImage } from "@/components/token-image";
import { SegmentedList, SegmentedTrigger, Tabs, TabsContent } from "@/components/ui/tabs";
import { LABEL } from "@/components/ui/tokens";
import { useMempool } from "@/hooks/use-mempool";
import { ALL_LAUNCHES_PAGE_SIZE, fetchAllLaunchesPage } from "@/lib/all-launches";
import { fetchBlockHeight } from "@/lib/api/counterparty";
import { fetchLaunchStats } from "@/lib/api/launchpad-api";
import { fetchMarketPrices } from "@/lib/api/price";
import { priceChangePercent } from "@/lib/market";
import { blocksDuration, fromSats } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/client";
import { localePath } from "@/lib/i18n/locales";
import { useNumbers } from "@/lib/i18n/numbers";
import { msg } from "@/lib/i18n/t";
import type { LaunchPage, SectionRow } from "@/lib/launch-row";
import { directoryHref } from "@/lib/launch-directory";
import type { LaunchPhase } from "@/lib/xcp69";
import {
  Card, LaunchTable, Pager, SORTS, SortMenu,
  ViewToggle, type Denomination, type SortOption, type View,
} from "@/app/[lang]/_components/launch-sections";
import { HomeToolbar } from "@/app/[lang]/_components/home-toolbar";
import { GraveyardCard } from "@/app/[lang]/graveyard/_components/graveyard-list";

const PHASES: { id: LaunchPhase; label: string }[] = [
  { id: "graduated", label: msg("Graduated") },
  { id: "minting", label: msg("Minting") },
  { id: "scheduled", label: msg("Scheduled") },
  { id: "refunded", label: msg("Graveyard") },
];
const deadline = (row: SectionRow) => row.fm.soft_cap_deadline_block || row.fm.end_block;
const REFUNDED_SORTS: SortOption[] = [
  { id: "failed", label: msg("Failed on"), by: (a, b) => deadline(b) - deadline(a) },
  { id: "progress", label: msg("Progress"), by: (a, b) => b.progress - a.progress },
  { id: "minters", label: msg("Minters"), by: (a, b) => (b.minters ?? -1) - (a.minters ?? -1) },
];

export function AllLaunchesView({ phase }: { phase: LaunchPhase }) {
  const t = useT();
  const locale = useLocale();
  const num = useNumbers();
  const router = useRouter();
  const query = useSearchParams();
  const options = phase === "refunded" ? REFUNDED_SORTS : SORTS[phase]!;
  const sort = options.find((option) => option.id === query.get("sort"))?.id ?? options[0]!.id;
  const view: View = query.get("view") === "table" ? "table" : "grid";
  const denomination: Denomination = query.get("denomination") === "xcp" ? "xcp" : "usd";
  const updateControls = (next: { sort?: string; view?: View }) => {
    router.replace(localePath(locale, directoryHref(phase, { sort, view, denomination, ...next })), { scroll: false });
  };
  const [totals, setTotals] = useState<Partial<Record<LaunchPhase, number>>>({});
  const onTotal = useCallback((phase: LaunchPhase, total: number) => {
    setTotals((previous) => previous[phase] === total ? previous : { ...previous, [phase]: total });
  }, []);
  // One cached aggregate supplies every tab count without loading four lists.
  // The visible page's own total remains authoritative for its count/pager.
  const { data: counts } = useSWR("launch-counts", async () => {
    const stats = await fetchLaunchStats();
    if (!stats) throw new Error("launch_counts_unavailable");
    return stats.counts;
  }, { refreshInterval: 300_000, revalidateOnFocus: false });
  const { data: height, error: heightError, isLoading: heightLoading, mutate: refreshHeight } = useSWR("chain-height", fetchBlockHeight, {
    refreshInterval: 60_000, revalidateOnFocus: false,
  });
  const { data: prices } = useSWR("market-prices", fetchMarketPrices, {
    refreshInterval: 60_000, dedupingInterval: 60_000, revalidateOnFocus: false,
  });
  const change = (current: number | null | undefined, previous: number | null | undefined) =>
    current != null && previous != null ? priceChangePercent(current, previous) : null;
  const { mints, orders } = useMempool(30_000);
  const pendingMints = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mint of [...mints, ...orders]) counts.set(mint.asset, (counts.get(mint.asset) ?? 0) + 1);
    return counts;
  }, [mints, orders]);

  return (
    <div className="space-y-10">
    <h1 className="sr-only">{t(PHASES.find((item) => item.id === phase)!.label)}</h1>
    <HomeToolbar
      height={height ?? 0} btcUsd={prices?.btc ?? null} xcpUsd={prices?.xcp ?? null}
      btcChange30d={change(prices?.btc, prices?.btcUsd30dAgo)}
      xcpChange30d={change(prices?.xcp, prices?.xcpUsd30dAgo)}
    />
    <Tabs value={phase} onValueChange={(value) => {
      const nextPhase = PHASES.find((item) => item.id === value)?.id;
      if (nextPhase) router.push(localePath(locale, directoryHref(nextPhase, { view, denomination })), { scroll: false });
    }}>
      <LaunchPhasePanel
        key={phase}
        navigation={
        <SegmentedList className="w-fit min-w-0 max-w-full flex-wrap sm:[&>[role=tab]]:py-0.5">
          {PHASES.map((item) => {
            const count = item.id === phase
              ? totals[item.id] ?? counts?.[item.id]
              : counts?.[item.id] ?? totals[item.id];
            return (
            <SegmentedTrigger key={item.id} value={item.id} grow={false}>
              {t(item.label)}
              <span className="ms-1.5 text-xs font-normal tabular-nums text-gray-400 dark:text-gray-500">{count === undefined ? "—" : num.commas(count)}</span>
            </SegmentedTrigger>
            );
          })}
        </SegmentedList>
        }
          phase={phase} sort={sort} onSort={(sort) => updateControls({ sort })}
          view={view} denomination={denomination}
          onView={(view) => updateControls({ view })}
          height={height ?? 0} heightPending={heightLoading}
          heightFailed={Boolean(heightError) || (!heightLoading && height !== undefined && height <= 0)}
          onRetryHeight={() => { void refreshHeight(); }}
          xcpUsd={prices?.xcp ?? null} xcpUsdDayAgo={prices?.xcpUsdDayAgo ?? null}
          pendingMints={pendingMints} onTotal={onTotal}
      />
    </Tabs>
    </div>
  );
}

interface LoadedPage extends LaunchPage { page: number; sort: string }

function LaunchPhasePanel({
  phase, sort, onSort, view, denomination, height, heightPending, heightFailed,
  xcpUsd, xcpUsdDayAgo, pendingMints, onTotal, onRetryHeight, navigation, onView,
}: {
  phase: LaunchPhase; view: View; denomination: Denomination;
  sort: string; onSort: (value: string) => void;
  height: number; heightPending: boolean; heightFailed: boolean;
  xcpUsd: number | null; xcpUsdDayAgo: number | null; pendingMints: Map<string, number>;
  onTotal: (phase: LaunchPhase, total: number) => void;
  onRetryHeight: () => void;
  navigation: ReactNode;
  onView: (value: View) => void;
}) {
  const t = useT();
  const options = phase === "refunded" ? REFUNDED_SORTS : SORTS[phase]!;
  const [pagination, setPagination] = useState({ sort, page: 0 });
  const page = pagination.sort === sort ? pagination.page : 0;
  const setPage = (page: number) => setPagination({ sort, page });
  const [knownTotal, setKnownTotal] = useState<number | null>(null);
  const [clamping, setClamping] = useState(false);
  // URL changes include browser history and language navigation. Reset before
  // selecting the SWR key so a new sort never requests the previous page.
  if (pagination.sort !== sort) {
    setPagination({ sort, page: 0 });
    setClamping(false);
  }
  const { mutate: refreshPage } = useSWRConfig();
  const lastPage = knownTotal === null ? page : Math.max(0, Math.ceil(knownTotal / ALL_LAUNCHES_PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  const needsTip = sort === "pace";
  const ready = !needsTip || height > 0;
  const { data: fetched, error, isLoading, mutate } = useSWR<LoadedPage>(
    ready ? ["all-launches", phase, sort, current, needsTip ? height : null] : null,
    async () => ({
      ...await fetchAllLaunchesPage(phase, sort, current, needsTip ? height : undefined),
      page: current, sort,
    }),
    {
      refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true,
      onSuccess: (result) => {
        const last = Math.max(0, Math.ceil(result.total / ALL_LAUNCHES_PAGE_SIZE) - 1);
        setKnownTotal(result.total);
        if (result.page > last) {
          // A page disappeared. Clear only its replacement's older cache and
          // dedupe marker before switching keys, so the smaller fresh total
          // cannot resurrect an old full first page. The new key fetches once.
          setClamping(true);
          void refreshPage(["all-launches", phase, result.sort, last, needsTip ? height : null], undefined);
          setPage(last);
        } else {
          setClamping(false);
        }
      },
    },
  );
  // During a clamp, keepPreviousData can still hold the now-missing page.
  // Wait for its replacement instead of presenting either old cached slice.
  const data = clamping ? undefined : fetched;
  const visibleTotal = data?.total;
  useEffect(() => {
    if (visibleTotal !== undefined) onTotal(phase, visibleTotal);
  }, [visibleTotal, onTotal, phase]);
  const waiting = isLoading || (!ready && heightPending);
  const failed = Boolean(error) || (!ready && heightFailed);
  const displayedPage = data?.page ?? current;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / ALL_LAUNCHES_PAGE_SIZE));
  const label = t(PHASES.find((item) => item.id === phase)!.label);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {navigation}
        <div className="ms-auto flex min-w-0 max-w-full items-center gap-2">
        <SortMenu
          label={t("Sort {section}", { section: label })} options={options}
          value={failed && data ? data.sort : sort}
          onChange={onSort}
        />
        <ViewToggle value={view} onChange={onView} />
        </div>
      </div>
      <TabsContent value={phase} className="mt-3 space-y-4">
      {!data ? (
        <p role="status" className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {failed ? t("The service is busy or unavailable. Try again shortly.") : t("Loading launches…")}
        </p>
      ) : data.total === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t("No launches in this phase.")}</p>
      ) : (
        <div aria-busy={waiting} className={waiting ? "opacity-50 transition-opacity" : undefined}>
          {view === "table" ? (
            phase === "refunded"
              ? <RefundedTable rows={data.rows} offset={displayedPage * ALL_LAUNCHES_PAGE_SIZE} height={height} />
              : <LaunchTable rows={data.rows} phase={phase} offset={displayedPage * ALL_LAUNCHES_PAGE_SIZE} height={height} xcpUsd={xcpUsd} xcpUsdDayAgo={xcpUsdDayAgo} denomination={denomination} countMode="minters" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
              {data.rows.map((row) => phase === "refunded"
                ? <GraveyardCard key={row.fm.tx_hash} row={row} height={height} />
                : <Card key={row.fm.tx_hash} row={row} height={height} xcpUsd={xcpUsd} xcpUsdDayAgo={xcpUsdDayAgo} denomination={denomination} pending={pendingMints.get(row.fm.asset) ?? 0} fresh={false} />)}
            </div>
          )}
        </div>
      )}
      {failed && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {data && <span>{t("Couldn't refresh this page. Showing the last version that loaded.")}</span>}
          <button type="button" className="rounded-lg border border-gray-200 px-3 py-1.5 hover:text-gray-900 dark:border-gray-700 dark:hover:text-gray-100" onClick={() => { if (!ready) onRetryHeight(); else void mutate(); }}>{t("Try again")}</button>
        </div>
      )}
      {data && pages > 1 && <Pager page={Math.min(displayedPage, pages - 1)} pages={pages} onGo={(next) => { if (next === page) void mutate(); else setPage(next); }} />}
      </TabsContent>
    </div>
  );
}

function RefundedTable({ rows, offset, height }: { rows: SectionRow[]; offset: number; height: number }) {
  const t = useT();
  const num = useNumbers();
  const cell = "whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300";
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <table className="w-full min-w-[38rem] text-sm">
        <thead><tr className="border-b border-gray-100 dark:border-gray-800">
          <th scope="col" className={`px-3 py-2.5 text-left ${LABEL}`}>{t("Token")}</th>
          {[msg("Progress"), msg("Refunded"), msg("Minters"), msg("Closed")].map((key) => <th key={key} scope="col" className={`px-3 py-2.5 text-right ${LABEL}`}>{t(key)}</th>)}
        </tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={row.fm.tx_hash} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60">
            <td className="px-3 py-2.5"><LazyLink href={`/${row.fm.asset}`} className="flex items-center gap-2.5">
              <span className="w-5 shrink-0 text-xs tabular-nums text-gray-400">{num.commas(offset + index + 1)}</span>
              <TokenImage asset={row.fm.asset} className="size-7 shrink-0 rounded-lg bg-gray-100 object-cover grayscale dark:bg-gray-800" />
              <span className="font-semibold">{row.fm.asset_longname ?? row.fm.asset}</span>
            </LazyLink></td>
            <td className={cell}>{num.percent(row.progress, { minDigits: 1 })}</td>
            <td className={cell}>{num.compact(fromSats(row.fm.paid_quantity ?? 0))} XCP</td>
            <td className={cell}>{row.minters === null ? "—" : num.commas(row.minters)}</td>
            <td className={cell}>{deadline(row) > 0 && height >= deadline(row) ? t("failed {age} ago", { age: blocksDuration(height - deadline(row), t) }) : "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
