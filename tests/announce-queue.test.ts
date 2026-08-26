/**
 * How the feed behaves when it falls behind.
 *
 * The only branching decision the queue makes, and the one place a mistake is
 * invisible: collapsing one message too many, or summing a digest short,
 * produces something that still looks exactly like a message.
 */
import { describe, expect, it } from "vitest";
import { nextAnnouncement, type Queued } from "#api/telegram/digest";
import { MINT_EMOJI } from "#api/telegram/format";

const raw = (whole: bigint) => (whole * 100_000_000n).toString();

const mintOf = (asset: string, tokens: bigint, xcpWhole: bigint): Queued => ({
  a: { text: `one ${asset} mint`, photo: null, asset },
  mintOf: asset,
  earned: raw(tokens),
  paid: raw(xcpWhole),
});

const other = (): Queued => ({
  a: { text: "a launch announcement", photo: null, asset: null },
  mintOf: null,
  earned: "0",
  paid: "0",
});

describe("below the threshold", () => {
  it("says each thing on its own", () => {
    const q = [mintOf("A", 100_000n, 1n), mintOf("A", 100_000n, 1n)];
    const { announcement, rest } = nextAnnouncement(q, 25);
    expect(announcement.text).toBe("one A mint");
    expect(rest).toHaveLength(1);
  });
});

describe("above the threshold", () => {
  const backlog = (n: number, asset = "A") =>
    Array.from({ length: n }, () => mintOf(asset, 100_000n, 1n));

  it("collapses a run on one launch into a single line", () => {
    const { announcement, rest } = nextAnnouncement(backlog(30), 25);
    expect(announcement.text).toContain("30 mints");
    expect(rest).toHaveLength(0);
  });

  it("sums the run rather than reporting the first of it", () => {
    // 30 mints of 100k is 3,000,000 tokens and 30 XCP. A digest that reported
    // the head's amounts would read 100,000 · 1 XCP and look completely
    // ordinary.
    const { announcement } = nextAnnouncement(backlog(30), 25);
    expect(announcement.text).toContain("3,000,000 tokens");
    expect(announcement.text).toContain("30 XCP");
  });

  it("sizes the bar on the total, capped", () => {
    const { announcement } = nextAnnouncement(backlog(30), 25);
    expect(announcement.text.match(new RegExp(MINT_EMOJI, "gu"))).toHaveLength(20);
  });

  it("stops at the first mint of a different launch", () => {
    const q = [...backlog(3, "A"), ...backlog(27, "B")];
    const { announcement, rest } = nextAnnouncement(q, 25);
    expect(announcement.text).toContain("3 mints");
    expect(rest).toHaveLength(27);
    expect(rest[0]!.mintOf).toBe("B");
  });

  it("never collapses anything that is not a mint", () => {
    // A launch announcement and a graduation are not events that arrive in
    // runs, and a "3 launches" line would be meaningless.
    const q = [other(), ...backlog(29)];
    const { announcement, rest } = nextAnnouncement(q, 25);
    expect(announcement.text).toBe("a launch announcement");
    expect(rest).toHaveLength(29);
  });

  it("leaves a lone mint as itself", () => {
    // Collapsing a run of one would trade a mint's own message — its minter,
    // its progress — for a strictly worse summary of the same thing.
    const q = [mintOf("A", 100_000n, 1n), ...backlog(29, "B")];
    const { announcement, rest } = nextAnnouncement(q, 25);
    expect(announcement.text).toBe("one A mint");
    expect(rest).toHaveLength(29);
  });

  it("keeps exact amounts across a large run", () => {
    // Token quantities run to 1e16 raw. A digest that summed these as numbers
    // would drift, and the drift would look like a plausible total.
    const big = Array.from({ length: 26 }, () => mintOf("A", 1_000_000n, 10n));
    const { announcement } = nextAnnouncement(big, 25);
    expect(announcement.text).toContain("26,000,000 tokens");
    expect(announcement.text).toContain("260 XCP");
  });
});
