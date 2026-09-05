"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, FocusEvent, PointerEvent, TouchEvent } from "react";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  href: string;
};

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
 * explicit that `false` means never), so this asks the router itself when the
 * pointer arrives, the finger lands, or focus reaches the link — the moment
 * a navigation becomes likely rather than merely possible. On desktop that
 * is indistinguishable from the old behaviour; on touch the prefetch gets a
 * head start of roughly the tap duration instead of the scroll-by. Use it
 * for per-row links in lists and tables. The bounded site chrome — header
 * nav, a page's single call-to-action — keeps the default.
 */
export function LazyLink({
  href,
  onPointerEnter,
  onTouchStart,
  onFocus,
  ...rest
}: Props) {
  const router = useRouter();
  const warm = () => router.prefetch(href);
  return (
    <Link
      href={href}
      prefetch={false}
      onPointerEnter={(event: PointerEvent<HTMLAnchorElement>) => {
        onPointerEnter?.(event);
        warm();
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        onTouchStart?.(event);
        warm();
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        onFocus?.(event);
        warm();
      }}
      {...rest}
    />
  );
}
