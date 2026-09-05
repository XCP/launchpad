"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ComponentProps, FocusEvent, PointerEvent } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  href: string;
};

/**
 * A mouse crossing the launch grid enters every card on its way. This is
 * the dwell that separates "passing over" from "hovering": instant.page
 * settled on 65 ms, and a click after a hover this short is rare enough
 * that losing the head start on it costs nothing visible.
 */
const HOVER_DWELL_MS = 80;

/**
 * A Link that prefetches on intent, not on sight.
 *
 * `next/link` prefetches every href that scrolls into view, and in Next 16 a
 * prefetch is two requests: the route tree, then the segment. On a page whose
 * content IS a list of links that is O(rows) server work for pages nobody
 * asked for. One homepage view fired ~112 prefetches for 56 launch cards; one
 * asset page fired one per holder on the Holders tab. In a two-minute
 * production sample prefetches were 39% of this Worker's invocations and,
 * counting the stale-ISR revalidations they set off, about 37% of its CPU,
 * against two RSC requests that were actual navigations.
 *
 * `prefetch={false}` alone would also drop the hover prefetch (the docs are
 * explicit that `false` means never), so this asks the router itself when a
 * mouse or pen has rested on the link, or keyboard focus has reached it —
 * the moment a navigation becomes likely rather than merely possible.
 *
 * Touch gets no prefetch at all, deliberately. A scroll gesture begins with a
 * finger on whatever card is under it, so a touch-start handler turned every
 * flick through the homepage into a prefetch of a random launch — a production
 * sample showed one phone issuing ninety of them. Pointer-enter fires for
 * touch too, so it is filtered by pointer type. A tap therefore fetches on
 * navigation, one round trip against an ISR-cached page.
 *
 * Every internal link on the site goes through this, not only the lists.
 * The header nav and a page's single call-to-action looked bounded, but a
 * "Get XCP" button on every asset page prefetched /dispense twice per view
 * and could set off a 200 ms+ revalidation render of a page the visitor
 * never opened. Nothing here should import next/link directly.
 */
export function LazyLink({
  href,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  ...rest
}: Props) {
  const router = useRouter();
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (dwell.current !== null) {
      clearTimeout(dwell.current);
      dwell.current = null;
    }
  };
  useEffect(() => cancel, []);

  return (
    <Link
      href={href}
      prefetch={false}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerEnter?.(event);
        if (event.pointerType === "touch") return;
        cancel();
        dwell.current = setTimeout(() => {
          dwell.current = null;
          router.prefetch(href);
        }, HOVER_DWELL_MS);
      }}
      onPointerLeave={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerLeave?.(event);
        cancel();
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        // Pointer focus arrives a moment before the click that caused it,
        // and a prefetch then only duplicates the navigation's own fetch.
        // Keyboard focus is the one that predicts an Enter.
        if (event.currentTarget.matches(":focus-visible")) router.prefetch(href);
      }}
      {...rest}
    />
  );
}
