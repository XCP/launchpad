import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, isUnlocalizedPath } from "@/lib/i18n/locales";

/**
 * Puts every page under its locale segment without the URL saying so for
 * English.
 *
 * Pages live under `app/[lang]`. A Japanese URL carries its own prefix, so
 * `/ja/faq` matches directly. An English URL has none, so `/faq` is
 * REWRITTEN — not redirected — to `/en/faq`: the visitor and the crawler see
 * `/faq`, the router sees the segment it needs, and the cache key stays the
 * URL that was asked for. A request that spells the default out, `/en/faq`,
 * is redirected to the bare form so there is exactly one English URL for
 * each page.
 *
 * That is all this does. It reads no Accept-Language and sets no cookie:
 * the URL is the only thing that decides the language, which is what keeps
 * pages cacheable per URL, shared links stable, and Googlebot — which
 * crawls from the US with no language header — able to see every version.
 * The browser's preference only ever produces a suggestion, in the page.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isUnlocalizedPath(pathname)) return;

  const [, first = ""] = pathname.split("/");

  // `/en/...` spelled out: one canonical English URL, the bare one.
  if (first === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(`/${DEFAULT_LOCALE}`.length) || "/";
    return NextResponse.redirect(url, 308);
  }

  // Already under a real locale prefix: nothing to do.
  if (isLocale(first)) return;

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Everything except Next's own assets and anything with a file extension.
  // Route handlers are excluded again inside, by name, so the list of
  // unlocalized paths has one definition.
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
