"use client";

import { HoverCard as H, Popover as P } from "radix-ui";
import type { ReactNode } from "react";

const CONTENT =
  "hover-pop z-50 w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-gray-200 bg-white p-4 shadow-xl focus:outline-none";

/**
 * Rich preview attached to a small trigger. Radix handles what the CSS-only
 * version couldn't: a safe pointer path from trigger to card, portalling so
 * the card is never clipped by a parent, edge-aware placement, and opening
 * on keyboard focus for anyone not using a mouse.
 *
 * Where there's no hover to speak of, the same content opens on tap as a
 * popover — otherwise the preview simply doesn't exist on a phone.
 */
export function HoverCard({
  trigger,
  children,
  onArm,
  touch = false,
}: {
  trigger: ReactNode;
  children: ReactNode;
  /** Fires the first time the card is about to open, so the consumer can
   *  defer its fetching until someone actually asks for the preview. */
  onArm?: () => void;
  /** Open on tap instead of hover (coarse pointers). */
  touch?: boolean;
}) {
  const arm = (open: boolean) => {
    if (open) onArm?.();
  };

  if (touch) {
    return (
      <P.Root onOpenChange={arm}>
        <P.Trigger asChild>{trigger}</P.Trigger>
        <P.Portal>
          <P.Content
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className={CONTENT}
          >
            {children}
            <P.Arrow className="fill-white" width={12} height={6} />
          </P.Content>
        </P.Portal>
      </P.Root>
    );
  }

  return (
    <H.Root openDelay={120} closeDelay={120} onOpenChange={arm}>
      <H.Trigger asChild>{trigger}</H.Trigger>
      <H.Portal>
        <H.Content
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className={CONTENT}
        >
          {children}
          <H.Arrow className="fill-white" width={12} height={6} />
        </H.Content>
      </H.Portal>
    </H.Root>
  );
}
