/**
 * Turning chain facts into human time. Kept apart from the components that
 * render them: "how long ago" is not a launch concern, and three different
 * surfaces were reaching into a launch file to get it.
 */

/** Compact age: 5m, 6h, 3d, 2w, 14mo, 3y. Terse by design — these sit in
 *  chips and beside addresses, where words would crowd the line. */
export const timeAgo = (unixSec: number) => {
  const min = (Date.now() / 1000 - unixSec) / 60;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.round(min)}m ago`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 14) return `${Math.round(days)}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  if (days < 730) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
};

export const daysSince = (unixSec: number) => (Date.now() / 1000 - unixSec) / 86_400;

export const monthYear = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

/** Age of a block, from its own timestamp. Coarser than timeAgo on purpose —
 *  this labels a block tile, where "7m" and "just now" mean the same thing. */
export function blockAge(sec: number) {
  const min = Math.floor((Date.now() / 1000 - sec) / 60);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}
