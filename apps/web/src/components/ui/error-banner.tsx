"use client";

import type { ReactNode } from "react";

/** The red inline failure notice. Renders nothing without children. */
export function ErrorBanner({
  children,
  className = "",
  onDismiss,
}: {
  children: ReactNode;
  className?: string;
  /** Shows a close button when provided — lets the user clear the error
   *  themselves instead of waiting on the next submit or a state change. */
  onDismiss?: () => void;
}) {
  if (!children) return null;
  return (
    <p
      className={`flex items-start justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}
    >
      <span>{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded p-1 text-red-400 hover:text-red-600"
        >
          ×
        </button>
      )}
    </p>
  );
}
