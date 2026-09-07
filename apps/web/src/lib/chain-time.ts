/**
 * Turning chain facts into human time. Kept apart from the components that
 * render them: "how long ago" is not a launch concern, and three different
 * surfaces were reaching into a launch file to get it.
 *
 * Every function takes the page's `t` so the words come out in the
 * visitor's language — "3週間前" rather than "3w ago" — and defaults to
 * English for callers with no locale to hand. Digits stay Latin everywhere.
 */
import { makeT, type T } from "@/lib/i18n/t";

const ENGLISH: T = makeT({});

/** Compact age: 5m ago, 6h ago, 3d ago, 2w ago, 14mo ago, 3y ago. Terse by
 *  design — these sit in chips and beside addresses, where words would
 *  crowd the line. */
export const timeAgo = (unixSec: number, t: T = ENGLISH) => {
  const min = (Date.now() / 1000 - unixSec) / 60;
  if (min < 1) return t("just now");
  if (min < 60) return t("{n}m ago", { n: Math.round(min) });
  const hours = min / 60;
  if (hours < 24) return t("{n}h ago", { n: Math.round(hours) });
  const days = hours / 24;
  if (days < 14) return t("{n}d ago", { n: Math.round(days) });
  if (days < 60) return t("{n}w ago", { n: Math.round(days / 7) });
  if (days < 730) return t("{n}mo ago", { n: Math.round(days / 30) });
  return t("{n}y ago", { n: Math.round(days / 365) });
};

export const daysSince = (unixSec: number) => (Date.now() / 1000 - unixSec) / 86_400;

/** "Aug 2026" in the visitor's language: Intl knows every month name. */
export const monthYear = (unixSec: number, locale = "en") =>
  new Date(unixSec * 1000).toLocaleDateString(locale, {
    month: "short",
    year: "numeric",
  });

/** Age of a block, from its own timestamp. Coarser than timeAgo on purpose —
 *  this labels a block tile, where "7m" and "just now" mean the same thing. */
export function blockAge(sec: number, t: T = ENGLISH) {
  const min = Math.floor((Date.now() / 1000 - sec) / 60);
  if (min < 1) return t("just now");
  if (min < 60) return t("{n}m ago", { n: min });
  return t("{n}h ago", { n: Math.floor(min / 60) });
}
