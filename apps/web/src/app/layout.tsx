import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { PendingDock } from "@/components/pending-dock";
import { SiteHeader } from "@/components/site-header";
import { SitePresenceBadge } from "@/components/site-presence";
import { SessionProvider } from "@/providers/session-context";
import { SwrProvider } from "@/providers/swr-provider";
import { WalletProvider } from "@/lib/wallet/wallet-context";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "xcp.fun — XCP-69 Launchpad",
  description:
    "Trustless token launches on Counterparty. All-or-nothing mints, liquidity locked by consensus, no platform custody.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">
        <SwrProvider>
        <WalletProvider>
        <SessionProvider>
        <SiteHeader />
        {/* Bottom padding clears the fixed corner overlays — without it the
            last line of any page sits under the presence badge or the dock. */}
        <main className="mx-auto max-w-5xl px-4 pb-24 pt-8">{children}</main>
        {/* Corner overlays: the site's pulse bottom-left, your own money
            moving bottom-right. */}
        <SitePresenceBadge />
        <PendingDock />
        </SessionProvider>
        </WalletProvider>
        </SwrProvider>
        {/* Fathom Analytics. data-spa="auto" is not optional here: the App
            Router navigates with the History API, so without it every visit
            would record as a single pageview no matter how far the visitor
            went. Default afterInteractive strategy — analytics has no business
            loading ahead of the app itself. */}
        <Script
          src="https://cdn.usefathom.com/script.js"
          data-site="IBYGVDZY"
          data-spa="auto"
          data-honor-dnt="true"
        />
      </body>
    </html>
  );
}
