"use client";

import Link from "next/link";
import { TokenImage } from "@/components/token-image";
import { compact, fromSats, usd } from "@/lib/format";
import { usePortfolio } from "@/app/profile/_lib/use-portfolio";
import { WITHHELD_COPY } from "@/lib/withheld-copy";

export function HistoryTab({ address }: { address: string }) {
  const { portfolio, isLoading } = usePortfolio(address);

  if (isLoading) return <p className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">Loading history…</p>;

  const closed = portfolio?.closed ?? [];
  const xcpUsd = portfolio?.xcpUsd ?? null;

  if (closed.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No closed positions yet.
      </p>
    );
  }

  const incomplete = closed.some((c) => c.realizedXcpSats === null);
  const total = closed.reduce((sum, c) => sum + (c.realizedXcpSats ?? 0n), 0n);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {incomplete ? "Known realized PnL" : "Realized PnL"}
        </p>
        <Realized sats={total} xcpUsd={xcpUsd} large />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Across {closed.length} fully exited {closed.length === 1 ? "position" : "positions"}
        </p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {closed.map((c) => (
          <li key={c.asset} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <Link href={`/${c.asset}`} className="flex min-w-0 items-center gap-2 hover:text-purple-600 dark:hover:text-purple-400">
              <TokenImage asset={c.asset} className="size-7 shrink-0 rounded" />
              <span className="truncate font-medium">{c.asset}</span>
            </Link>
            <span className="shrink-0 text-right">
              <Realized sats={c.realizedXcpSats} xcpUsd={xcpUsd} />
              {/* This list dropped the reason entirely — it was computed and
                  then never passed, so a dash here explained nothing at all. */}
              {c.withheld && (
                <span
                  className="mt-0.5 block text-[10px] leading-tight text-gray-400 dark:text-gray-500"
                  title={WITHHELD_COPY[c.withheld].full}
                >
                  {WITHHELD_COPY[c.withheld].short}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Positions you fully exited, with the profit or loss actually taken.
        A dash means the focused mint-and-trade history does not explain the
        live zero balance, so no P&amp;L is claimed.
        Basis is average-cost, so a partial sale realizes its share and leaves
        the rest with the tokens still held.
      </p>
    </div>
  );
}

function Realized({
  sats,
  xcpUsd,
  large = false,
}: {
  sats: bigint | null;
  xcpUsd: number | null;
  large?: boolean;
}) {
  if (sats === null) return <span className="text-gray-400 dark:text-gray-500" title="Unexplained balance movement">—</span>;
  const up = sats >= 0n;
  // Magnitude in integer space; the sign is carried by the label.
  const xcp = fromSats((up ? sats : -sats).toString());
  return (
    <span
      className={`${large ? "text-3xl font-semibold" : "tabular-nums"} ${
        up ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      {up ? "+" : "−"}
      {xcpUsd ? usd(xcp * xcpUsd) : `${compact(xcp)} XCP`}
    </span>
  );
}
