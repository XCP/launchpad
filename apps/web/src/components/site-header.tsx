"use client";

import { msg } from "@/lib/i18n/t";
import { LazyLink } from "@/components/lazy-link";
import { DropdownMenu as DM } from "radix-ui";
import { HeaderWallet } from "@/components/header-wallet";
import { CurrencySubmenu, CurrencySwitch, LanguageSubmenu, LanguageSwitch } from "@/components/language-switch";
import { usePathname } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/client";
import { splitLocale, type Locale } from "@/lib/i18n/locales";
import { MempoolChip, useMempoolCount } from "@/components/mempool-chip";
import { RewardsChip } from "@/components/rewards-chip";
import { TELEGRAM_URL, TelegramChip } from "@/components/telegram-chip";

/**
 * The site header.
 *
 * Desktop badges stay at the viewport's center, independently of the two
 * navigation groups. Locale-specific spacing and Telegram visibility keep
 * that center clear while a connected wallet and queued transactions show.
 * Below `nav` (1024px), links move into the menu and status chips take turns.
 */

const LINKS = [
  { href: "/swap", label: msg("Swap") },
  { href: "/limit", label: msg("Limit") },
  { href: "/dispense", label: msg("Dispense") },
];

/** Secondary, and kept beside the wallet per the header's reading order:
 *  what you came to do on the left, what you look up on the right.
 *
 *  Docs is not here. It is the longest word of the four in most languages
 *  (Documentación, Документація, ドキュメント) and the least urgent: nobody
 *  arrives needing the specification, and the people who do want it will
 *  find it. Dropping one item buys every language the room the English row
 *  never needed, and it still has two homes — the phone menu and the
 *  footer — so nothing became unreachable. */
const SECONDARY = [
  { href: "/activity", label: msg("Activity") },
  { href: "/stats", label: msg("Stats") },
  { href: "/faq", label: msg("FAQ") },
];

/** Both chips are links in the header rather than in this row — but the phone
 *  menu still needs them as destinations, since a chip is a teaser and the
 *  menu is the actual index of the site. Rewards especially: on a phone the
 *  chip is the ONLY way to reach it, and the chip stands aside whenever
 *  mempool is up, so without this entry the page would be unreachable for
 *  exactly as long as something is queued. */
const MENU_EXTRA = [
  { href: "/rewards", label: msg("XCP Rewards") },
  { href: "/mempool", label: msg("Mempool") },
  { href: "/docs", label: msg("Docs") },
];

// Measured with a connected wallet and three-digit mempool count. The inline
// language control leaves the row at 1340px; all locales fit all badges there.
// Every locale has an explicit policy so new translations require a fit check.
const DESKTOP_LAYOUT: Record<Locale, "all" | "defer-telegram" | "tight-nav"> = {
  en: "defer-telegram",
  es: "tight-nav",
  pt: "tight-nav",
  fr: "defer-telegram",
  ja: "defer-telegram",
  ko: "all",
  ru: "tight-nav",
  uk: "tight-nav",
  zh: "all",
  "zh-tw": "all",
  "zh-hk": "all",
};

export function SiteHeader() {
  const t = useT();
  const layout = DESKTOP_LAYOUT[useLocale()];
  // Phones prioritize queued work. Desktop keeps both status badges and lets
  // Telegram yield first when the centered group would crowd navigation.
  const queued = useMempoolCount() > 0;

  return (
    // `relative` for the language menu, which sits in the viewport's corner
    // outside the centred row when the window is wide enough to have one.
    <header className="relative border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      {/* The language menu, in three places by width and never two at once.
          Wide enough for a margin beyond the 1024px row, it sits in the
          corner where a reader who cannot read the page will look for a
          globe. Narrower, it joins the row beside the wallet. On phones it
          is a section of the menu. The corner has room for separate globe
          and currency controls at 1340px; the language name joins them at
          1536px without touching the centered navigation row. */}
      <div className="absolute end-4 top-1/2 hidden -translate-y-1/2 items-center gap-2 min-[1340px]:flex">
        <div className="min-[1536px]:hidden">
          <LanguageSwitch compact includeCurrency={false} />
        </div>
        <div className="hidden min-[1536px]:block">
          <LanguageSwitch includeCurrency={false} />
        </div>
        <CurrencySwitch />
      </div>
      {/* Navigation stays anchored to the sides; badges have their own center. */}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-1 px-2 py-3 min-[360px]:gap-3 min-[360px]:px-4">
        <div className="flex shrink-0 items-center gap-5">
          <LazyLink
            href="/"
            className="flex shrink-0 items-center gap-1.5 text-lg font-bold tracking-tight"
          >
            {/* Matches the favicon, so the tab and the header read as the same
                site at a glance. aria-hidden because the wordmark beside it
                already says the name. */}
            <span aria-hidden>🎉</span>
            {/* One flex item, not two. A bare text node beside a span becomes
                its own anonymous flex item, so the row's gap was landing
                between XCP and .FUN — it reads as a domain, so it can't. */}
            <span>
              XCP<span className="text-purple-600 dark:text-purple-400">.FUN</span>
            </span>
          </LazyLink>
          <nav className="hidden items-center gap-4 text-sm font-medium text-gray-600 dark:text-gray-400 nav:flex">
            {LINKS.map((l) => (
              <LazyLink key={l.href} href={l.href} className="whitespace-nowrap hover:text-gray-900 dark:hover:text-gray-100">
                {t(l.label)}
              </LazyLink>
            ))}
          </nav>
        </div>

        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 nav:flex">
          <RewardsChip />
          <MempoolChip />
          <TelegramChip className={queued && layout !== "all" ? "hidden min-[1340px]:flex" : ""} />
        </div>

        <div className={`flex shrink-0 items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 min-[360px]:gap-4 ${layout === "tight-nav" ? "nav:gap-3 min-[1340px]:gap-4" : ""}`}>
          {/* Telegram uses its icon on phones and in translated headers.
              Status chips take turns here to leave room for the menu. */}
          <span className="flex items-center gap-1 min-[360px]:gap-2 nav:hidden">
            {queued ? <MempoolChip className="max-[360px]:gap-1 max-[360px]:px-2" /> : <RewardsChip />}
            <TelegramChip />
          </span>
          <nav className={`hidden items-center nav:flex ${layout === "tight-nav" ? "gap-2 min-[1340px]:gap-4" : "gap-4"}`}>
            {SECONDARY.map((l) => (
              <LazyLink key={l.href} href={l.href} className="whitespace-nowrap hover:text-gray-900 dark:hover:text-gray-100">
                {t(l.label)}
              </LazyLink>
            ))}
          </nav>
          <div className="hidden nav:block min-[1340px]:hidden">
            <LanguageSwitch compact />
          </div>
          <div className="hidden nav:block">
            <HeaderWallet />
          </div>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}

/**
 * The phone's navigation. Radix supplies the behaviour a hand-rolled menu
 * usually gets wrong — focus trapping, Escape, arrow keys, closing on outside
 * click, and the aria-expanded wiring — while the responsive decision of when
 * to show it stays a plain Tailwind breakpoint.
 */
function MobileMenu() {
  const t = useT();
  const { path } = splitLocale(usePathname() ?? "/");
  const item =
    "block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-800 data-[highlighted]:text-gray-900 dark:data-[highlighted]:text-gray-100";

  return (
    <DM.Root>
      <DM.Trigger
        aria-label={t("Open menu")}
        className="flex size-9 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700 hover:text-gray-900 dark:hover:text-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 nav:hidden"
      >
        {/* Three bars, drawn rather than shipped as an icon dependency. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none">
          <path
            d="M2 4h12M2 8h12M2 12h12"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          // w-48 is what the longest language name needs on its row before it
          // truncates: 繁體中文（香港）. The submenu is the same width and
          // overlaps this menu when it opens, because 390px will not hold two
          // side by side and a covered parent reads better than a clipped
          // name. max-h is Radix's own measurement of the room below the
          // trigger, so the menu can never again run past the fold.
          className="modal-pop z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-48 overflow-y-auto overscroll-contain rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-1.5 shadow-lg"
        >
          {LINKS.map((l) => (
            <DM.Item key={l.href} asChild>
              <LazyLink href={l.href} className={item}>
                {t(l.label)}
              </LazyLink>
            </DM.Item>
          ))}
          <DM.Separator className="my-1.5 h-px bg-gray-100 dark:bg-gray-800" />
          {[...MENU_EXTRA, ...SECONDARY].map((l) => (
            <DM.Item key={l.href} asChild>
              <LazyLink href={l.href} className={item}>
                {t(l.label)}
              </LazyLink>
            </DM.Item>
          ))}
          <DM.Item asChild>
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" className={item}>
              {t("Telegram")}
            </a>
          </DM.Item>
          <DM.Separator className="my-1.5 h-px bg-gray-100 dark:bg-gray-800" />
          {/* Language and currency, each a submenu. Listed inline they were
              eleven rows and thirty-one, and this menu is the one place with
              no room to spare: on a phone it is the whole navigation. Both
              triggers name what is in force, so the choice is still visible
              without opening either. */}
          <LanguageSubmenu path={path} />
          <CurrencySubmenu overlap />
          {/* Create is available beside the homepage search. */}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
