import { permanentRedirect } from "next/navigation";
import { isLocale, localePath } from "@/lib/i18n/locales";
import { directoryHref, PHASE_PATHS } from "@/lib/launch-directory";
import type { LaunchPhase } from "@/lib/xcp69";

/** Existing shared links retain their phase, language and display choices. */
export default async function AllLaunchesPage({ params, searchParams }: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  const requested = query.phase;
  const phase: LaunchPhase = typeof requested === "string" && Object.hasOwn(PHASE_PATHS, requested)
    ? requested as LaunchPhase : "graduated";
  const one = (key: string) => typeof query[key] === "string" ? query[key] as string : undefined;
  permanentRedirect(localePath(isLocale(lang) ? lang : "en", directoryHref(phase, {
    sort: one("sort"), view: one("view"), denomination: one("denomination"),
  })));
}
