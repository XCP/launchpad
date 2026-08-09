"use client";

import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";

/**
 * The site's one modal shape (token/route pickers): centered card under a
 * dimmed backdrop. Radix supplies what the hand-rolled version lacked —
 * focus trapping, Escape, scroll lock, focus return to the trigger, and
 * aria wiring. Content unmounts on close, so per-open state (search text)
 * resets for free.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="backdrop-fade fixed inset-0 z-50 bg-black/40" />
        <D.Content className="modal-pop fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 rounded-3xl bg-white p-3 shadow-xl focus:outline-none">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <D.Title className="text-sm font-semibold text-gray-900">
              {title}
            </D.Title>
            <D.Close
              aria-label="Close"
              className="flex size-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
