import { splitLocale } from "@/lib/i18n/locales";
import type { LaunchPhase } from "@/lib/xcp69";

export const PHASE_PATHS: Record<LaunchPhase, string> = {
  graduated: "/graduated", minting: "/minting", scheduled: "/scheduled", refunded: "/graveyard",
};

export function phaseForPath(pathname: string): LaunchPhase | null {
  const { path } = splitLocale(pathname);
  return (Object.keys(PHASE_PATHS) as LaunchPhase[]).find((phase) => PHASE_PATHS[phase] === path) ?? null;
}

/** UI preferences travel with a listing link; the phase belongs in its path. */
export function directoryHref(phase: LaunchPhase, options: {
  sort?: string; view?: string; denomination?: string;
} = {}): string {
  const query = new URLSearchParams();
  if (options.sort) query.set("sort", options.sort);
  if (options.view === "table") query.set("view", options.view);
  if (options.denomination === "xcp") query.set("denomination", options.denomination);
  const suffix = query.toString();
  return `${PHASE_PATHS[phase]}${suffix ? `?${suffix}` : ""}`;
}
