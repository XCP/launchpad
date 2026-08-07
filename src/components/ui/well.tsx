"use client";

import type { ReactNode } from "react";

/**
 * The input/display panel of every trading card: label row, the big
 * number beside its asset chip, and a fixed-height footer (USD line,
 * hints, presets) so wells never shift as data arrives. `focusable`
 * wells read as an inset that follows the caret.
 */
export function Well({
  label,
  topRight,
  chip,
  footer,
  focusable = false,
  layout = "row",
  children,
}: {
  label: ReactNode;
  topRight?: ReactNode;
  chip?: ReactNode;
  footer?: ReactNode;
  focusable?: boolean;
  /**
   * "row" puts the chip beside the amount (wide surfaces); "stack" gives
   * the amount the full width and drops the chip to its own bottom row —
   * the pons pattern for tight rails, where a long asset name beside the
   * input squeezes the number it exists to serve.
   */
  layout?: "row" | "stack";
  children: ReactNode;
}) {
  return (
    <div
      className={
        focusable
          ? "group rounded-2xl border border-transparent bg-gray-50 p-4 transition-colors focus-within:border-gray-200 focus-within:bg-white"
          : "rounded-2xl bg-gray-50 p-4"
      }
    >
      <div className="flex h-5 items-center justify-between text-xs text-gray-500">
        <span>{label}</span>
        {topRight}
      </div>
      {layout === "row" ? (
        <div className="mt-1 flex items-center justify-between gap-3">
          {children}
          {chip}
        </div>
      ) : (
        <div className="mt-1">{children}</div>
      )}
      {footer !== undefined && (
        <div className="mt-1 flex h-4 items-center justify-between text-xs text-gray-400">
          {footer}
        </div>
      )}
      {layout === "stack" && chip !== undefined && (
        <div className="mt-2 flex items-center">{chip}</div>
      )}
    </div>
  );
}
