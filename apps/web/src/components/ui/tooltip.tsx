"use client";

import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

/**
 * Hint: keyboard- and screen-reader-accessible replacement for title
 * attributes. Wrap any element; the content shows on hover AND focus.
 */
export function Hint({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <T.Provider delayDuration={200}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content
            sideOffset={6}
            className="z-50 max-w-64 rounded-lg bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs leading-relaxed text-white dark:text-gray-900 shadow-lg"
          >
            {content}
            <T.Arrow className="fill-gray-900 dark:fill-gray-100" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
