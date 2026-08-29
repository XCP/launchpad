"use client";

import { Tabs as T } from "radix-ui";
import type { ReactNode } from "react";

/**
 * The segmented control, in both site variants: "pill" (gray track, white
 * active — the toggles above cards) and "card" (white track, gray active —
 * tab bars inside cards). Radix supplies arrow-key navigation and real
 * tablist semantics.
 */
export const Tabs = T.Root;
export const TabsContent = T.Content;

export function SegmentedList({
  className = "",
  children,
  variant = "pill",
}: {
  className?: string;
  children: ReactNode;
  variant?: "pill" | "card";
}) {
  return (
    <T.List
      className={
        variant === "pill"
          ? `flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 text-sm font-medium ${className}`
          : `flex flex-wrap items-center gap-1 text-sm font-medium ${className}`
      }
    >
      {children}
    </T.List>
  );
}

export function SegmentedTrigger({
  value,
  children,
  variant = "pill",
  grow = true,
}: {
  value: string;
  children: ReactNode;
  variant?: "pill" | "card";
  grow?: boolean;
}) {
  return (
    <T.Trigger
      value={value}
      className={
        variant === "pill"
          ? `${grow ? "flex-1 " : ""}rounded-md px-3 py-1.5 capitalize text-gray-500 dark:text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-300 data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900 data-[state=active]:text-gray-900 dark:data-[state=active]:text-gray-100 data-[state=active]:shadow-sm`
          : `rounded-md px-3 py-1.5 capitalize text-gray-500 dark:text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-300 data-[state=active]:bg-gray-100 dark:data-[state=active]:bg-gray-800 data-[state=active]:text-gray-900 dark:data-[state=active]:text-gray-100`
      }
    >
      {children}
    </T.Trigger>
  );
}
