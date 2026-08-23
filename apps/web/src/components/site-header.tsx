"use client";

import Link from "next/link";
import { DropdownMenu as DM } from "radix-ui";
import { HeaderWallet } from "@/components/header-wallet";
import { MempoolChip, useMempoolCount } from "@/components/mempool-chip";
import { RewardsChip } from "@/components/rewards-chip";
import { TELEGRAM_URL, TelegramChip } from "@/components/telegram-chip";

/**
 * The site header.
 *
 * Mobile is the constraint that shapes it. Everything shown at once needed
 * roughly 460px of content in the ~358px a 390px phone actually offers — the
 * logo, three section links, a Launch button and a 152px address pill — so it
 * simply overflowed. Two things give way rather than being shrunk:
 *
 *  - Launch has left the header entirely. It is the homepage's call to action,
 *    not a permanent fixture, and it competed with the section links on every
 *    other page for space none of them had.
 *  - Below `nav` (880px, defined in globals.css) the links collapse into one
 *    menu button, which is the only honest way to fit six destinations on a
 *    narrow screen.
 *
 * That threshold is measured, not chosen, and it is not one of Tailwind's own
 * stops because none of them fits. In the band between the burger and `lg` the
 * row carries both nav groups, the inline status chips and the wallet, and it
 * needs 761px with a Connect button — but 822px once a wallet is connected and
 * that button becomes a 137px address pill. The connected state is the one a
 * desktop visitor is usually in, so it is the one the breakpoint has to clear.
 *
 * `sm` (640px) was therefore wrong by ~180px and had been since before Activity
 * joined the secondary links; `md` (768px) is still 54px short. The row does not
 * break when it overruns — it squeezes the one group allowed to shrink — so the
 * failure was quiet rather than visible, which is exactly why it survived.
 * `lg` (1024px) would fit but hides the links on every tablet, so 880px it is.
 *
 * The wallet is desktop-only, and that is a statement of fact rather than a
 * layout compromise: the XCP Wallet is a browser extension, and no mobile
 * browser can run it. Offering Connect on a phone would be offering something
 * that cannot work.
 */

const LINKS = [
  { href: "/swap", label: "Swap" },
  { href: "/limit", label: "Limit" },
  { href: "/dispense", label: "Dispense" },
];

/** Secondary, and kept beside the wallet per the header's reading order:
 *  what you came to do on the left, what you look up on the right. */
const SECONDARY = [
  { href: "/activity", label: "Activity" },
  { href: "/stats", label: "Stats" },
  { href: "/faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

/** Both chips are links in the header rather than in this row — but the phone
 *  menu still needs them as destinations, since a chip is a teaser and the
 *  menu is the actual index of the site. Rewards especially: on a phone the
 *  chip is the ONLY way to reach it, and the chip stands aside whenever
 *  mempool is up, so without this entry the page would be unreachable for
 *  exactly as long as something is queued. */
const MENU_EXTRA = [
  { href: "/rewards", label: "XCP Rewards" },
  { href: "/mempool", label: "Mempool" },
];

export function SiteHeader() {
  // Below `lg` the chips sit inline, in the row's remaining space — and there
  // is only ever enough of it for one. Two at once pushed the wordmark until
  // 🎉 XCP.FUN began to truncate, which is the one thing in the row that can't
  // give way. So the pair becomes a priority: queued work outranks a standing
  // offer, and rewards steps aside for the minute or two mempool is up.
  const queued = useMempoolCount() > 0;

  return (
    <header className="border-b border-gray-200 bg-white">
      {/* `relative` so the mempool chip can be centred on the HEADER rather
          than on whatever gap the two nav groups happen to leave — those
          change width with the wallet's state, and a "centre" that drifts
          when you connect isn't one. */}
      <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-5">
          <Link
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
              XCP<span className="text-purple-600">.FUN</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-4 text-sm font-medium text-gray-600 nav:flex">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-gray-900">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Dead centre of the HEADER, absolutely placed so it doesn't drift
            when the wallet changes width. Only from `lg`: below that the two
            nav groups leave under ~110px of true centre, and a "centred" chip
            that overlaps the links beside it is worse than one that doesn't
            claim to be centred. Narrower screens get it inline, below. */}
        <div className="pointer-events-none absolute inset-x-0 hidden justify-center lg:flex">
          {/* Rewards is always on; mempool joins it only when something is
              queued, so the group re-centres itself as one unit. Telegram sits
              last — the two before it are about this site's own state, and it
              is the one that leaves. That also makes it the only chip whose
              position is fixed: second normally, third when the mempool has
              something to say. */}
          <div className="pointer-events-auto flex items-center gap-2">
            <RewardsChip />
            <MempoolChip />
            <TelegramChip />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 text-sm font-medium text-gray-600">
          {/* Beside the burger on a phone, and beside the links in the band
              between — the same chips, just not pretending to be centred, and
              never both at once. */}
          {/* Telegram survives the one-chip rule because it costs almost
              nothing to keep: below `lg` it is the logo alone, no label, so it
              adds an icon's width rather than a word's. The status chip still
              takes turns beside it — that constraint was about text, and this
              does not spend any. */}
          <span className="flex items-center gap-2 lg:hidden">
            {queued ? <MempoolChip /> : <RewardsChip />}
            <TelegramChip />
          </span>
          <nav className="hidden items-center gap-4 nav:flex">
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-gray-900">
                {l.label}
              </Link>
            ))}
          </nav>
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
  const item =
    "block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 outline-none data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900";

  return (
    <DM.Root>
      <DM.Trigger
        aria-label="Open menu"
        className="flex size-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 nav:hidden"
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
          className="modal-pop z-50 w-48 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg"
        >
          {LINKS.map((l) => (
            <DM.Item key={l.href} asChild>
              <Link href={l.href} className={item}>
                {l.label}
              </Link>
            </DM.Item>
          ))}
          <DM.Separator className="my-1.5 h-px bg-gray-100" />
          {[...MENU_EXTRA, ...SECONDARY].map((l) => (
            <DM.Item key={l.href} asChild>
              <Link href={l.href} className={item}>
                {l.label}
              </Link>
            </DM.Item>
          ))}
          <DM.Separator className="my-1.5 h-px bg-gray-100" />
          {/* An external destination, so it says so — the menu is the index of
              the site and this is the one row that leaves it. */}
          <DM.Item asChild>
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" className={item}>
              Telegram ↗
            </a>
          </DM.Item>
          <DM.Item asChild>
            <Link href="/create" className={item}>
              Create a launch
            </Link>
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
