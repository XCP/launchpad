"use client";

import { Popover as P } from "radix-ui";
import type { ReactNode } from "react";

/**
 * The settings-gear popover, shared by the swap and liquidity widgets.
 * Radix supplies Escape, outside-click dismissal, focus return, and
 * collision-aware positioning the hand-rolled version lacked.
 */
export function GearPopover({
  active,
  label,
  small = false,
  children,
}: {
  /** Highlights the gear when a non-default setting is in effect. */
  active: boolean;
  label: string;
  /** Compact trigger for inline placement (e.g. a well's label row). */
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <P.Root>
      <P.Trigger
        aria-label={label}
        className={`group flex items-center justify-center rounded-full transition-colors data-[state=open]:bg-purple-50 data-[state=open]:text-purple-600 ${
          small ? "size-5" : "size-7"
        } ${
          active
            ? "bg-purple-50 text-purple-600"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        }`}
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={small ? "size-3.5" : "size-4"}
        >
          <path
            fillRule="evenodd"
            d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
            clipRule="evenodd"
          />
        </svg>
      </P.Trigger>
      <P.Portal>
        <P.Content
          align="end"
          sideOffset={8}
          className="modal-pop z-50 w-64 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg focus:outline-none"
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
