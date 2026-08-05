import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WalletProvider } from "@/lib/wallet/wallet-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "xcp.fun — XCP-69 Launchpad",
  description:
    "Trustless token launches on Counterparty. All-or-nothing mints, liquidity locked by consensus, no platform custody.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased">
        <WalletProvider>
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <a href="/" className="text-lg font-bold tracking-tight">
              xcp<span className="text-purple-600">.fun</span>
            </a>
            <nav className="flex items-center gap-4 text-sm font-medium text-gray-600">
              <a href="/standard" className="hover:text-gray-900">Standard</a>
              <a
                href="/create"
                className="rounded-md bg-gray-900 px-3 py-1.5 text-white hover:bg-gray-700"
              >
                Launch
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
