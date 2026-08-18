/**
 * How the search box decides what a typed query means.
 *
 * Pure and out of the component so it can be tested: a matcher that is wrong
 * is silent — it returns a list, the list looks like a list, and the only
 * symptom is that the thing you wanted is not in it. The component keeps the
 * parts that need React (the phase chips, the per-phase orderings); the two
 * questions below are the ones where being wrong costs someone the launch
 * they were looking for.
 */
import type { SearchRow } from "@/lib/launch-row";

/**
 * How well a row answers the query, lower being better.
 *
 * An exact asset beats a prefix beats a substring — typing "STAR" should put
 * STAR above STARMONEY above MYSTARS, which plain substring matching gets
 * wrong in all three positions. Only used while something is typed; with an
 * empty box the chosen sort orders the list on its own.
 *
 * 5 means no match at all, and is the cutoff the caller filters on.
 */
export function relevance(row: SearchRow, q: string): number {
  const asset = row.asset;
  const name = (row.name ?? "").toUpperCase();
  if (asset === q) return 0;
  if (asset.startsWith(q)) return 1;
  if (name.startsWith(q)) return 2;
  if (asset.includes(q)) return 3;
  if (name.includes(q)) return 4;
  return 5;
}

/** Anything scoring below this matched the query somehow. */
export const NO_MATCH = 5;

/**
 * Whether the query names this launch outright rather than matching part of it.
 *
 * The threshold a refunded launch has to clear to be shown at all. Prefix and
 * substring matches are the search being helpful — offering candidates for a
 * half-typed word — and a refund is never a helpful candidate: typing STAR to
 * reach STARMONEY should not have to step over STARDUST, which raised nothing
 * and gave it back.
 *
 * Naming it in full is a different act. Then the refunded launch IS the answer
 * to the question asked, and hiding it would make the box deny something in
 * the index — the one failure this search must not have.
 *
 * The longname counts as naming it. Typing the whole identifier is the same
 * act either way, and for a subasset the longname is the name a holder knows.
 *
 * An empty query names nothing, which is what keeps refunded launches out of
 * the list you get just by opening the box.
 */
export function namedOutright(row: SearchRow, q: string): boolean {
  return q !== "" && (row.asset === q || (row.name ?? "").toUpperCase() === q);
}

/**
 * Whether a row is a refunded launch the query did not ask for by name — the
 * rows search holds back, counted rather than silently dropped.
 */
export function hiddenAsRefunded(row: SearchRow, q: string): boolean {
  return row.phase === "refunded" && !namedOutright(row, q);
}
