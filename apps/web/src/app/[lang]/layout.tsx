import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import type { ReactNode } from "react";
import { LocaleSuggest } from "@/components/locale-suggest";
import { PendingDock } from "@/components/pending-dock";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SitePresenceBadge } from "@/components/site-presence";
import { SessionProvider } from "@/providers/session-context";
import { ChatProvider } from "@/providers/chat-context";
import { SwrProvider } from "@/providers/swr-provider";
import { LocaleProvider } from "@/lib/i18n/client";
import { isLocale, LOCALE_INFO, LOCALES } from "@/lib/i18n/locales";
import { openGraphLocale } from "@/lib/i18n/seo";
import { getMessages, isMachineDrafted } from "@/lib/i18n/server";
import { makeT } from "@/lib/i18n/t";
import { METADATA_ORIGIN } from "@/lib/metadata";
import { WalletProvider } from "@/lib/wallet/wallet-context";
import "@/app/globals.css";

/**
 * Every page lives under this segment, so `lang` is a root parameter: the
 * proxy rewrites an unprefixed English URL to `/en/...` and a Japanese URL
 * arrives with its own prefix. Nothing else about the request decides the
 * language — see src/proxy.ts for why.
 */
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    metadataBase: new URL(METADATA_ORIGIN),
    title: t("xcp.fun — XCP-69 Launchpad"),
    description: t(
      "Trustless token launches on Counterparty. All-or-nothing mints, liquidity locked by consensus, no platform custody.",
    ),
    // Canonical and language alternatives belong to each page. A homepage
    // fallback here would incorrectly identify any page without its own.
    // No title or description here on purpose: a page's own then flow into
    // og:title and og:description, while the site-level facts are inherited.
    openGraph: { type: "website", siteName: "xcp.fun", ...openGraphLocale(locale) },
  };
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const info = LOCALE_INFO[lang];
  // Only this locale's messages reach the browser; English carries none.
  const [messages, machine] = await Promise.all([getMessages(lang), isMachineDrafted(lang)]);

  return (
    <html lang={info.tag} dir={info.dir}>
      <head>
        {/* The document never names the origins its data comes from, so the
            browser cannot open a socket to them until React has hydrated and a
            hook fires -- each one then pays a cold DNS + TCP + TLS handshake
            before its first byte. Only origins reached from the root layout
            belong here; a preconnect a page does not use holds a socket open
            for ten seconds for nothing. cdn.xcp.io is the art fallback behind
            every TokenImage, and our APIs serve the page's indexed data. */}
        <link rel="preconnect" href="https://api.xcp.fun" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.xcp.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn.xcp.io" />
      </head>
      <body className="min-h-dvh bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <LocaleProvider locale={lang} messages={messages} machine={machine}>
        <SwrProvider>
        <WalletProvider>
        <SessionProvider>
        <ChatProvider>
        <SiteHeader />
        {/* The one line of the page that reacts to the browser's language:
            an offer to switch, never a switch. */}
        <LocaleSuggest />
        <main className="mx-auto max-w-5xl px-4 pb-8 pt-8">{children}</main>
        {/* The footer carries the bottom padding that clears the fixed corner
            overlays — without it its own line, the last on any page, sits
            under the presence badge or the dock. */}
        <SiteFooter />
        {/* Corner overlays: the site's pulse bottom-left, your own money
            moving bottom-right. */}
        <SitePresenceBadge />
        <PendingDock />
        </ChatProvider>
        </SessionProvider>
        </WalletProvider>
        </SwrProvider>
        </LocaleProvider>
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
