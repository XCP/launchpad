"use client";

import { HoverCard as H } from "radix-ui";
import type { ReactNode } from "react";

/**
 * Rich hover preview (issuer identity). Radix handles what the CSS-only
 * version couldn't: a safe pointer path from trigger to card, portalling so
 * the card is never clipped by a parent, edge-aware placement, and opening
 * on keyboard focus for anyone not using a mouse.
 */
export function HoverCard({
  trigger,
  children,
  onArm,
}: {
  trigger: ReactNode;
  children: ReactNode;
  /** Fires the first time the card is about to open, so the consumer can
   *  defer its fetching until someone actually asks for the preview. */
  onArm?: () => void;
}) {
  return (
    <H.Root
      openDelay={120}
      closeDelay={120}
      onOpenChange={(open) => {
        if (open) onArm?.();
      }}
    >
      <H.Trigger asChild>{trigger}</H.Trigger>
      <H.Portal>
        <H.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="hover-pop z-50 w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-gray-200 bg-white p-4 shadow-xl focus:outline-none"
        >
          {children}
          <H.Arrow className="fill-white" width={12} height={6} />
        </H.Content>
      </H.Portal>
    </H.Root>
  );
}
