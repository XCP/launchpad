import type { Metadata } from "next";
import Link from "next/link";
import { LiveBehaviorDashboard } from "@/app/research/_components/live-behavior-dashboard";
import { METADATA_ORIGIN } from "@/lib/metadata";

const title = "Launch dynamics — xcp.fun";
const description =
  "See what sellers do next, where known dumpers are minting, and how much seller inventory remains.";

export const metadata: Metadata = {
  metadataBase: new URL(METADATA_ORIGIN),
  title,
  description,
  alternates: { canonical: METADATA_ORIGIN + "/research" },
  openGraph: {
    type: "website",
    url: METADATA_ORIGIN + "/research",
    siteName: "xcp.fun",
    title,
    description,
  },
  twitter: { card: "summary_large_image", title, description },
};

export default function ResearchPage() {
  return (
    <article className="mx-auto max-w-6xl space-y-7 sm:space-y-8">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">XCP-69</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Launch dynamics</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400 sm:text-base">
          What sellers do next, where known dumpers are minting, and how much seller inventory remains.
        </p>
      </header>

      <LiveBehaviorDashboard />

      <details className="group overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 marker:hidden sm:px-5">
          <span className="text-sm font-semibold">Method and limits</span>
          <span className="text-lg text-gray-400 dark:text-gray-500 transition group-open:rotate-45" aria-hidden="true">+</span>
        </summary>
        <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400 sm:px-5">
          <p>
            Counts use unique addresses. Held, moved, and sold are exclusive outcomes for minters of each
            graduated launch. Held means no sale and a meaningful current balance; moved means no sale and
            no meaningful current balance; sold means at least one pool or order-book sale captured by xcp.fun.
          </p>
          <p className="mt-2">
            Dump means the first sale landed within six blocks of graduation. Repeat dump means that happened
            on more than one earlier launch. Balances come from Counterparty and may include tokens obtained
            outside the mint. Pending mempool orders can disappear without confirming or filling. Addresses
            are not necessarily people.
          </p>
        </div>
      </details>

      <footer className="flex flex-col gap-3 border-t border-gray-200 dark:border-gray-800 pt-5 text-xs text-gray-400 dark:text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <p>Observed address behavior, not identity or intent. Not investment advice.</p>
        <div className="flex gap-3">
          <Link href="/faq" className="text-purple-600 dark:text-purple-400 hover:underline">How XCP-69 works</Link>
          <a href="https://t.me/xcpfun" target="_blank" rel="noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">Corrections</a>
        </div>
      </footer>
    </article>
  );
}
