import type { Metadata } from "next";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { fetchXcpUsd } from "@/lib/api/price";
import { fetchTradeableAssets } from "@/lib/tradeable";
import { LimitSurface } from "@/app/[lang]/limit/_components/limit-surface";

export const revalidate = 60;

const PAGE_METADATA = {
  title: "Limit — xcp.fun",
  description:
    "Place limit orders on graduated XCP-69 launches. Your price is enforced by the order itself — fills through the pool at confirmation or rests on the book.",
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  return { ...PAGE_METADATA, alternates: localeAlternates(isLocale(lang) ? lang : "en", "/limit") };
}

export default async function LimitPage() {
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
        <LimitSurface assets={assets} xcpUsd={xcpUsd} />
      )}
    </div>
  );
}
