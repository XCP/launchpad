import type { ReactNode } from "react";
import { LABEL } from "@/components/ui/tokens";

export function Stat({
  label,
  value,
  hint,
  mobileHint,
  className = "",
}: {
  label: string;
  value: string;
  /** Nodes rather than strings so a fiat figure inside can be a client leaf
   *  that follows the visitor's currency while the tile stays server-rendered. */
  hint: ReactNode;
  mobileHint?: ReactNode;
  /** Ordering only. Two columns read as three rows of pairs, and the pairs
   *  that belong together are not the ones source order produces. */
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 ${className}`}>
      <div className={LABEL}>{label}</div>
      <div className="mt-0.5 truncate text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-gray-400 dark:text-gray-500">
        <span className={mobileHint ? "hidden sm:inline" : undefined}>{hint}</span>
        {mobileHint ? <span className="sm:hidden">{mobileHint}</span> : null}
      </div>
    </div>
  );
}
