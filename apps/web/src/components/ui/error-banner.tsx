"use client";

import type { ReactNode } from "react";

/** The red inline failure notice. Renders nothing without children. */
export function ErrorBanner({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p
      className={`rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}
    >
      {children}
    </p>
  );
}
