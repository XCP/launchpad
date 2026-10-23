"use client";

import { useState, type PointerEvent } from "react";
import type { LaunchStats } from "@/lib/api/launchpad-api";
import { ACTIVITY_WINDOWS, statsActivity, type ActivityWindow } from "@/lib/stats-activity";
import { fromSats, tokenQty } from "@/lib/format";
import { useNumbers } from "@/lib/i18n/numbers";
import { useT } from "@/lib/i18n/client";
import { LazyLink } from "@/components/lazy-link";

export function EcosystemActivity({ stats }: { stats: LaunchStats }) {
  const [days, setDays] = useState<ActivityWindow>(28);
  const [selected, setSelected] = useState<number | null>(null);
  const num = useNumbers();
  const t = useT();
  const data = statsActivity(stats, days);
  if (!data) return <p className="rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 dark:border-gray-700">{t("Activity charts are unavailable right now.")}</p>;

  const { series, totals, assets } = data;
  const point = series[selected ?? series.length - 1]!;
  const about = (index: number) => index === series.length - 1 ? t("Current day · partial") : t("About {n}d ago", { n: series.length - 1 - index });
  const rows = [
    { label: t("Trading"), value: `${num.fixed(fromSats(totals.xcp), 1)} XCP`,
      detail: t("{n} fills · pools + order book", { n: num.commas(totals.fills) }),
      values: series.map(d => fromSats(d.xcp)), color: "text-emerald-600 dark:text-emerald-400",
      format: (value: number) => `${num.compact(value)} XCP` },
    { label: t("Burns & destructions"), value: num.commas(totals.burns),
      detail: t("Actions across {n} assets", { n: num.commas(assets.length) }),
      values: series.map(d => d.burns), color: "text-orange-600 dark:text-orange-400",
      format: (value: number) => num.compact(value) },
    { label: t("Minting"), value: num.commas(totals.mints), detail: t("mint transactions"),
      values: series.map(d => d.mints), color: "text-purple-600 dark:text-purple-400",
      format: (value: number) => num.compact(value) },
  ];

  return (
    <section aria-labelledby="ecosystem-heading" className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:px-6">
        <div>
          <h2 id="ecosystem-heading" className="font-semibold">{t("Activity")}</h2>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t("Last {n} days · approximate", { n: days })}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800" role="group" aria-label={t("Time range")}>
          {ACTIVITY_WINDOWS.map(window => (
            <button key={window} type="button" aria-pressed={days === window}
              onClick={() => { setDays(window); setSelected(null); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-purple-500 ${days === window ? "bg-white text-gray-950 shadow-sm dark:bg-gray-700 dark:text-white" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"}`}>
              {t("{n}d", { n: window })}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-gray-100 px-5 dark:divide-gray-800 sm:px-6">
        {rows.map(row => (
          <div key={row.label} className="grid gap-4 py-5 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-center sm:gap-6">
            <div>
              <h3 className={`text-xs font-semibold ${row.color}`}>{row.label}</h3>
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{row.value}</p>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{row.detail}</p>
            </div>
            <ActivityBars label={row.label} values={row.values} color={row.color}
              format={row.format} selected={selected} onSelect={setSelected} about={about} />
          </div>
        ))}
      </div>

      <div className="border-t border-gray-100 bg-gray-50/70 px-5 py-3 text-xs dark:border-gray-800 dark:bg-gray-950/30 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums" aria-live="polite" aria-atomic="true">
          <span className="font-medium">{about(selected ?? series.length - 1)}</span>
          <span className="text-emerald-700 dark:text-emerald-400">{num.fixed(fromSats(point.xcp), 2)} XCP</span>
          <span className="text-orange-700 dark:text-orange-400">{t("{n} burn actions", { n: num.commas(point.burns) })}</span>
          <span className="text-purple-700 dark:text-purple-400">{t("{n} mints", { n: num.commas(point.mints) })}</span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{t("144 blocks per day. Separate scales. Tap or hover to inspect.")}</p>
      </div>

      <div className="border-t border-gray-100 px-5 py-5 dark:border-gray-800 sm:px-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">{t("Most active burns")}</h3>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">{t("Same period · ranked by actions")}</span>
        </div>
        {assets.length === 0 ? <p className="mt-3 text-sm text-gray-500">{t("No burns in this window.")}</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="text-[11px] text-gray-500 dark:text-gray-400">
                <tr><th className="pb-2 font-normal">{t("Asset")}</th><th className="pb-2 text-right font-normal">{t("Actions")}</th><th className="pb-2 pl-4 text-right font-normal">{t("Tokens removed")}</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {assets.slice(0, 5).map(asset => (
                  <tr key={asset.asset}>
                    <td className="py-2.5 pr-4"><LazyLink href={`/${asset.asset}`} className="font-medium text-purple-600 hover:underline dark:text-purple-400">{asset.asset}</LazyLink></td>
                    <td className="py-2.5 text-right">{num.commas(asset.n)}</td>
                    <td className="py-2.5 pl-4 text-right" title={num.commasRaw(asset.quantity, asset.divisible ? 8 : 0)}>{num.compact(tokenQty(asset.quantity, asset.divisible))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{t("Holder burns and explicit destructions of launch tokens. Excludes LP tokens and failed-mint cleanup. Token amounts stay separate by asset.")}</p>
      </div>
    </section>
  );
}

function ActivityBars({ label, values, color, selected, onSelect, format, about }: {
  label: string; values: number[]; color: string; selected: number | null;
  onSelect: (index: number | null) => void; format: (value: number) => string; about: (index: number) => string;
}) {
  const t = useT();
  const peak = Math.max(...values, 1);
  const width = 560;
  const step = width / values.length;
  const chartHeight = 80;
  const selectAt = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSelect(Math.max(0, Math.min(values.length - 1, Math.floor((event.clientX - rect.left) / rect.width * values.length))));
  };
  return (
    <div className="min-w-0">
      <div className="mb-1 flex justify-between text-[10px] text-gray-400 dark:text-gray-500"><span>{format(peak)}</span><span>{t("per day")}</span></div>
      <svg viewBox={`0 0 ${width} 88`} preserveAspectRatio="none" role="img" aria-label={t("{label}. Use arrow keys to inspect days.", { label })}
        tabIndex={0} className={`h-24 w-full rounded-sm focus-visible:outline-2 focus-visible:outline-purple-500 ${color}`}
        onPointerDown={selectAt}
        onPointerMove={selectAt}
        onPointerLeave={event => { if (event.pointerType === "mouse") onSelect(null); }}
        onKeyDown={event => {
          const index = selected ?? values.length - 1;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onSelect(Math.max(0, Math.min(values.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
          } else if (event.key === "Escape") onSelect(null);
        }}>
        <title>{label}</title>
        {[0, 40, 80].map(y => <line key={y} x1="0" x2={width} y1={y + 4} y2={y + 4} className="stroke-gray-100 dark:stroke-gray-800" />)}
        {selected !== null && <rect x={selected * step} y="0" width={step} height="88" fill="currentColor" opacity="0.12" />}
        {values.map((value, i) => {
          const height = value > 0 ? Math.max(1, value / peak * chartHeight) : 0;
          return <rect key={i} x={i * step + 1} y={84 - height} width={Math.max(1, step - 2)} height={height} rx="1.5" fill="currentColor" opacity={i === selected ? 1 : i === values.length - 1 ? 0.4 : 0.7}>
            <title>{`${about(i)} · ${format(value)}`}</title>
          </rect>;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400 dark:text-gray-500"><span>{about(0)}</span><span>{t("Current day · partial")}</span></div>
    </div>
  );
}
