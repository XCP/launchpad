/**
 * What the search box will and will not show you.
 *
 * Every mistake here is silent. A matcher that scores wrong still returns a
 * list of real launches in a plausible order, and a hiding rule that is too
 * eager still returns results — just never the one that was typed. The only
 * way to notice either is to state the intended order and ask for it.
 */
import { describe, expect, it } from "vitest";
import type { SearchRow } from "@/lib/launch-row";
import { NO_MATCH, hiddenAsRefunded, namedOutright, relevance } from "@/lib/search-rank";

const row = (
  asset: string,
  extra: Partial<SearchRow> = {},
): SearchRow => ({
  asset,
  name: null,
  phase: "graduated",
  source: "bc1qexample",
  announceBlock: 800_000,
  minters: 1,
  marketCapXcp: 0,
  progress: 0,
  startBlock: 800_100,
  ...extra,
});

describe("relevance", () => {
  // The ordering the whole box rests on, and the one plain substring matching
  // gets wrong in all three positions.
  it("puts an exact asset above a prefix above a substring", () => {
    const q = "STAR";
    const ranked = [row("MYSTARS"), row("STARMONEY"), row("STAR")]
      .sort((a, b) => relevance(a, q) - relevance(b, q))
      .map((r) => r.asset);
    expect(ranked).toEqual(["STAR", "STARMONEY", "MYSTARS"]);
  });

  it("ranks the asset ahead of the longname at the same kind of match", () => {
    expect(relevance(row("STARMONEY"), "STAR")).toBeLessThan(
      relevance(row("OTHER", { name: "STARDUST" }), "STAR"),
    );
  });

  it("scores a miss at the cutoff the caller filters on", () => {
    expect(relevance(row("PEPECOIN"), "ZZZ")).toBe(NO_MATCH);
  });

  it("matches on the longname when the asset does not", () => {
    expect(relevance(row("A1234567890", { name: "PEPECOIN" }), "PEPE")).toBeLessThan(NO_MATCH);
  });
});

describe("namedOutright", () => {
  it("accepts the full asset name", () => {
    expect(namedOutright(row("PEPECOIN"), "PEPECOIN")).toBe(true);
  });

  it("accepts the full longname, which is the name a subasset holder knows", () => {
    expect(namedOutright(row("A1234567890", { name: "SOMEONE.PEPE" }), "SOMEONE.PEPE")).toBe(true);
  });

  it("rejects a prefix of the name", () => {
    expect(namedOutright(row("PEPECOIN"), "PEPE")).toBe(false);
  });

  it("rejects an empty query, so opening the box names nothing", () => {
    expect(namedOutright(row("PEPECOIN"), "")).toBe(false);
    // The blank asset a bad row could carry must not be named by a blank box.
    expect(namedOutright(row(""), "")).toBe(false);
  });
});

describe("hiddenAsRefunded", () => {
  const refunded = (asset: string, extra: Partial<SearchRow> = {}) =>
    row(asset, { phase: "refunded", ...extra });

  it("hides a refunded launch from a partial query", () => {
    expect(hiddenAsRefunded(refunded("STARDUST"), "STAR")).toBe(true);
  });

  it("hides refunded launches from an empty query", () => {
    expect(hiddenAsRefunded(refunded("STARDUST"), "")).toBe(true);
  });

  it("shows a refunded launch to someone who typed its whole name", () => {
    expect(hiddenAsRefunded(refunded("STARDUST"), "STARDUST")).toBe(false);
  });

  it("never hides a launch that is not refunded", () => {
    for (const phase of ["scheduled", "minting", "graduated"] as const) {
      expect(hiddenAsRefunded(row("STARDUST", { phase }), "STAR")).toBe(false);
      expect(hiddenAsRefunded(row("STARDUST", { phase }), "")).toBe(false);
    }
  });

  it("hides the refunded near-miss without hiding the live launch beside it", () => {
    // The case the rule exists for, run through both filters in the order the
    // component applies them: match on relevance, then hold back the dead.
    // STAR is what you want, STARDUST is the one that was in the way.
    const rows = [row("STAR", { phase: "minting" }), refunded("STARDUST")];
    const search = (q: string) =>
      rows
        .filter((r) => relevance(r, q) < NO_MATCH && !hiddenAsRefunded(r, q))
        .map((r) => r.asset);
    expect(search("STAR")).toEqual(["STAR"]);
    expect(search("STARDUST")).toEqual(["STARDUST"]);
  });
});
