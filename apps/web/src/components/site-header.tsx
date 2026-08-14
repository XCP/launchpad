"use client";

import Link from "next/link";
import { DropdownMenu as DM } from "radix-ui";
import { HeaderWallet } from "@/components/header-wallet";
import { MempoolChip } from "@/components/mempool-chip";
import { RewardsChip } from "@/components/rewards-chip";

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
 *  - Below `sm` the links collapse into one menu button, which is the only
 *    honest way to fit five destinations on a phone.
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
  { href: "/stats", label: "Stats" },
  { href: "/faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

/** Mempool is a chip in the header rather than a link in this row — but the
 *  phone menu still needs it as a destination, since a chip is a teaser and
 *  the menu is the actual index of the site. */
const MENU_EXTRA = { href: "/mempool", label: "Mempool" };

export function SiteHeader() {
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
          <nav className="hidden items-center gap-4 text-sm font-medium text-gray-600 sm:flex">
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
              queued, so the pair re-centres itself as one unit. */}
          <div className="pointer-events-auto flex items-center gap-2">
            <RewardsChip />
            <MempoolChip />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 text-sm font-medium text-gray-600">
          {/* Beside the burger on a phone, and beside the links in the band
              between — the same chips, just not pretending to be centred. */}
          <span className="flex items-center gap-2 lg:hidden">
            <RewardsChip />
            <MempoolChip />
          </span>
          <nav className="hidden items-center gap-4 sm:flex">
            {SECONDARY.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-gray-900">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="hidden sm:block">
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
        className="flex size-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 sm:hidden"
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
          {[MENU_EXTRA, ...SECONDARY].map((l) => (
            <DM.Item key={l.href} asChild>
              <Link href={l.href} className={item}>
                {l.label}
              </Link>
            </DM.Item>
          ))}
          <DM.Separator className="my-1.5 h-px bg-gray-100" />
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
