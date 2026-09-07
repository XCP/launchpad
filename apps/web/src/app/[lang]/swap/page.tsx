import type { Metadata } from "next";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { fetchXcpUsd } from "@/lib/api/price";
import { fetchTradeableAssets } from "@/lib/tradeable";
import { TradeSurface } from "@/app/[lang]/swap/_components/trade-surface";

export const revalidate = 60;

const PAGE_METADATA = {
  title: "Swap — xcp.fun",
  description:
    "Swap graduated XCP-69 assets through Counterparty pools and the order book, including direct token pairs when liquidity exists.",
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return { ...PAGE_METADATA, alternates: localeAlternates(isLocale(lang) ? lang : "en", "/swap") };
}

export default async function SwapPage() {
  const [assets, xcpUsd] = await Promise.all([
    fetchTradeableAssets(),
    fetchXcpUsd(),
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {assets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No launches have graduated yet. The first sell-out seeds the first
          pool — and it becomes tradeable here in the same block.
        </p>
      ) : (
        <TradeSurface assets={assets} xcpUsd={xcpUsd} />
      )}
    </div>
  );
}
