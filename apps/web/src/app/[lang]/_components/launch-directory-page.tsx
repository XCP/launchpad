import { Suspense } from "react";
import type { Metadata } from "next";
import { AllLaunchesView } from "@/app/[lang]/all/_components/all-launches-view";
import { PHASE_PATHS } from "@/lib/launch-directory";
import { isLocale } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import type { LaunchPhase } from "@/lib/xcp69";

const TITLES: Record<LaunchPhase, string> = {
  graduated: msg("Graduated"), minting: msg("Minting"),
  scheduled: msg("Scheduled"), refunded: msg("Graveyard"),
};
const DESCRIPTION = msg("Browse XCP-69 launches by phase: graduated, minting, scheduled, and refunded.");

export async function directoryMetadata(phase: LaunchPhase, { params }: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    title: `${t(TITLES[phase])} — xcp.fun`,
    description: phase === "refunded"
      ? t("XCP-69 launches that closed below their soft cap and refunded participants.")
      : t(DESCRIPTION),
    alternates: localeAlternates(locale, PHASE_PATHS[phase]),
  };
}

/** Shared shell: only the selected phase loads in the browser. */
export function LaunchDirectoryPage({ phase }: { phase: LaunchPhase }) {
  return (
    <div className="mx-auto max-w-5xl">
      <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-900" />}>
        <AllLaunchesView phase={phase} />
      </Suspense>
    </div>
  );
}
