import type { Metadata } from "next";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import { loadXcpBridge } from "@/app/[lang]/dispense/_lib/load-bridge";
import { BridgeRecovery } from "@/app/[lang]/dispense/_components/bridge-recovery";

export const revalidate = 60;

const PAGE_METADATA = {
  title: msg("Get XCP — xcp.fun"),
  description:
    msg("Load your wallet with XCP straight from Bitcoin — or unload it back. Minting costs XCP: 0.01 XCP per 1,000-token lot, 10 XCP for a max mint."),
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    ...PAGE_METADATA,
    title: t(String(PAGE_METADATA.title)),
    ...(PAGE_METADATA.description ? { description: t(PAGE_METADATA.description) } : {}),
    alternates: localeAlternates(locale, "/dispense"),
  };
}

export default async function GetXcpPage() {
  const snapshot = await loadXcpBridge();

  return (
    <div className="mx-auto max-w-lg space-y-6 lg:max-w-3xl">
      <BridgeRecovery {...snapshot} />

    </div>
  );
}
