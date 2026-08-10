"use client";

import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";

/**
 * The site's one modal shape (token/route pickers): centered card under a
 * dimmed backdrop. Radix supplies what the hand-rolled version lacked —
 * focus trapping, Escape, scroll lock, focus return to the trigger, and
 * aria wiring. Content unmounts on close, so per-open state (search text)
 * resets for free.
 *
 * `variant="lightbox"` drops the card chrome entirely — no title row, no
 * white panel, just a close button over whatever's passed in, sized to
 * fill most of the viewport. For art, not forms: the image is the content,
 * not a form living inside a labeled dialog.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  variant = "card",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  variant?: "card" | "lightbox";
}) {
  if (variant === "lightbox") {
    return (
      <D.Root open={open} onOpenChange={onOpenChange}>
        <D.Portal>
          <D.Overlay className="backdrop-fade fixed inset-0 z-50 bg-black/70" />
          <D.Content className="modal-pop fixed left-1/2 top-1/2 z-50 h-[85vh] w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 focus:outline-none">
            <D.Title className="sr-only">{title}</D.Title>
            <D.Close
              aria-label="Close"
              className="absolute -right-3 -top-3 flex size-9 items-center justify-center rounded-full bg-white text-gray-600 shadow-lg hover:bg-gray-100 sm:-right-4 sm:-top-4"
            >
              ✕
            </D.Close>
            {children}
          </D.Content>
        </D.Portal>
      </D.Root>
    );
  }

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
