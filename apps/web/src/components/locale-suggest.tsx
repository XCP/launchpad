"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Globe, LOCALE_PREF_KEY, rememberLocale } from "@/components/language-switch";
import { LazyLink } from "@/components/lazy-link";
import { trackEvent } from "@/lib/analytics";
import { useLocale } from "@/lib/i18n/client";
import { isLocale, type Locale, localePath, matchLocale, splitLocale } from "@/lib/i18n/locales";

const DISMISSED_KEY = "xcpfun:locale-dismissed:v1";
const EVENT = "xcpfun:locale-suggest";
const TRACKED_KEY = "xcpfun:browser-language-tracked:v1";

/**
 * What the browser asked for, reported once per session as an event: the
 * site locale it maps to, or the bare language tag when the site has no
 * such locale — "ru", "de", "id" — which is exactly the list of languages
 * worth adding next. Fathom already knows the country; this is the
 * language, which a country never tells you (Canada, Belgium, Switzerland).
 */
function trackBrowserLanguage() {
  try {
    if (sessionStorage.getItem(TRACKED_KEY)) return;
    sessionStorage.setItem(TRACKED_KEY, "1");
  } catch {
    // Private mode: count it anyway; a few double counts beat none.
  }
  const tag = navigator.languages?.[0] ?? navigator.language;
  if (!tag) return;
  const spoken = matchLocale(tag) ?? tag.toLowerCase().split("-")[0];
  trackEvent(`browser language: ${spoken}`);
}

/**
 * What the banner says, in the language it is offering — the reader it is
 * for cannot necessarily read the page it sits on.
 */
const OFFER: Record<Locale, { text: string; action: string; dismiss: string }> = {
  en: { text: "This site is also available in English.", action: "View in English", dismiss: "Dismiss" },
  ja: { text: "このサイトは日本語でも表示できます。", action: "日本語で表示", dismiss: "閉じる" },
  zh: { text: "本站也提供简体中文版。", action: "切换到简体中文", dismiss: "关闭" },
  "zh-tw": { text: "本站也提供繁體中文版。", action: "切換到繁體中文", dismiss: "關閉" },
  "zh-hk": { text: "本站亦提供繁體中文版。", action: "切換至繁體中文", dismiss: "關閉" },
  es: { text: "Este sitio también está disponible en español.", action: "Ver en español", dismiss: "Cerrar" },
  ko: { text: "이 사이트는 한국어로도 볼 수 있습니다.", action: "한국어로 보기", dismiss: "닫기" },
  pt: { text: "Este site também está disponível em português.", action: "Ver em português", dismiss: "Fechar" },
  fr: { text: "Ce site est aussi disponible en français.", action: "Voir en français", dismiss: "Fermer" },
  ru: { text: "Этот сайт доступен и на русском.", action: "Открыть на русском", dismiss: "Закрыть" },
  uk: { text: "Цей сайт доступний і українською.", action: "Відкрити українською", dismiss: "Закрити" },
};

/** The first of the browser's languages the site speaks, or null. */
function preferredLocale(): Locale | null {
  if (typeof navigator === "undefined") return null;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return null;
}

function storedLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_PREF_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

function dismissedLocales(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * The browser's answer to "would you rather read this in another language",
 * read as an external store so the banner renders from it without a
 * set-state-in-effect: null on the server and during hydration, then the
 * offered locale or null once the browser has been asked. Recomputed only
 * when a dismissal or a choice changes it.
 */
let snapshot: { current: Locale; offer: Locale | null } | null = null;

function readOffer(current: Locale): Locale | null {
  if (snapshot?.current === current) return snapshot.offer;
  let offer: Locale | null = null;
  if (storedLocale() === null) {
    const preferred = preferredLocale();
    if (preferred && preferred !== current && !dismissedLocales().includes(preferred)) {
      offer = preferred;
    }
  }
  snapshot = { current, offer };
  return offer;
}

function subscribe(onChange: () => void) {
  const handler = () => {
    snapshot = null;
    onChange();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function dismiss(locale: Locale) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...dismissedLocales(), locale])]));
  } catch {
    // Private mode: dismissed for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Detect, suggest, never force.
 *
 * The URL decides the language; this only notices when the browser would
 * have chosen differently and offers the switch as one line under the
 * header. Dismissing it is remembered per language, choosing it is
 * remembered as the preference. The one navigation it makes on its own is
 * for a return visitor arriving at the bare front door with a remembered
 * choice: `/` becomes `/ja`, because that is what they typed last time and
 * meant. Deep links are never redirected — a shared link shows what it says.
 *
 * Everything here runs after hydration, so crawlers see the page as its URL
 * describes it and caches stay per URL.
 */
export function LocaleSuggest() {
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const offer = useSyncExternalStore(
    subscribe,
    () => readOffer(current),
    () => null,
  );

  useEffect(() => {
    const stored = storedLocale();
    if (stored && pathname === "/" && stored !== current) router.replace(localePath(stored, "/"));
  }, [current, pathname, router]);

  useEffect(() => {
    trackBrowserLanguage();
  }, []);

  useEffect(() => {
    if (offer) trackEvent(`language suggested: ${offer}`);
  }, [offer]);

  if (!offer) return null;
  const copy = OFFER[offer];
  const { path } = splitLocale(pathname ?? "/");

  return (
    <div
      lang={offer}
      className="border-b border-purple-100 bg-purple-50 text-sm text-purple-900 dark:border-purple-950 dark:bg-purple-950/40 dark:text-purple-100"
    >
      <div className="mx-auto flex max-w-5xl items-center gap-x-4 gap-y-1 px-4 py-2 sm:flex-wrap">
        {/* The sentence and the link together are two lines on a phone, in
            every language — and the second line is the one worth tapping. So
            a narrow screen gets the globe and the action alone, which say the
            same thing in few enough words to fit beside the dismiss. The
            sentence comes back as soon as there is room for it. */}
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">
            <Globe />
          </span>
          <span className="hidden truncate sm:inline">{copy.text}</span>
        </span>
        <LazyLink
          href={path}
          locale={offer}
          onClick={() => {
            trackEvent(`language suggestion accepted: ${offer}`);
            rememberLocale(offer);
            window.dispatchEvent(new Event(EVENT));
          }}
          className="min-w-0 truncate font-semibold underline underline-offset-2"
        >
          {copy.action}
        </LazyLink>
        <button
          type="button"
          onClick={() => {
            trackEvent(`language suggestion dismissed: ${offer}`);
            dismiss(offer);
          }}
          className="ms-auto shrink-0 text-xs text-purple-700 hover:text-purple-900 dark:text-purple-300 dark:hover:text-purple-100"
        >
          {copy.dismiss}
        </button>
      </div>
    </div>
  );
}
