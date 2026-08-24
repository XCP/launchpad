import { describe, expect, it } from "vitest";
import { MIRRORS, pickArtUrl } from "#api/indexer/mirrors";

/**
 * Which picture a mirror copies, out of a metadata document nobody here
 * wrote.
 *
 * Silent when wrong, which is why it is tested: picking the 48x48 icon over
 * the full-size art, or reading a field that isn't there, produces a page
 * that looks completely normal and shows the wrong thing — and the refresher
 * would then hold that wrong answer for the whole launch, since it compares
 * URLs to decide whether anything changed.
 */

/** pepedust.com/j/EVOLVEDPEPE.json, as served — CIP-25 v2, both entries
 *  pointing at the same stage file, which is what stage 0 actually looks
 *  like. */
const EVOLVEDPEPE = {
  asset: "EVOLVEDPEPE",
  name: "EvolvedPepe",
  image: "https://pepedust.com/launch/img/pb299376139.png",
  images: [
    {
      type: "icon",
      size: "48x48",
      data: "https://pepedust.com/launch/img/pb299376139.png",
    },
    {
      type: "standard",
      data: "https://pepedust.com/launch/img/pb299376139.png",
      hash: "d3c7307eb373753f38f518333c73a15481c1754fce2bfbe925517a8e40dd5fad",
    },
  ],
};

describe("pickArtUrl", () => {
  it("takes the standard entry from a real CIP-25 v2 document", () => {
    expect(pickArtUrl(EVOLVEDPEPE)).toBe("https://pepedust.com/launch/img/pb299376139.png");
  });

  it("prefers full-size art over the icon when they differ", () => {
    expect(
      pickArtUrl({
        images: [
          { type: "icon", size: "48x48", data: "https://example.com/small.png" },
          { type: "standard", data: "https://example.com/big.png" },
        ],
      }),
    ).toBe("https://example.com/big.png");
  });

  it("falls back to the icon when that is all there is", () => {
    expect(
      pickArtUrl({
        images: [{ type: "icon", size: "48x48", data: "https://example.com/small.png" }],
      }),
    ).toBe("https://example.com/small.png");
  });

  it("reads the deprecated v1 image field when images[] is absent", () => {
    expect(pickArtUrl({ image: "https://example.com/v1.png" })).toBe(
      "https://example.com/v1.png",
    );
  });

  it("refuses a plaintext source", () => {
    // Mixed content on our own pages before it is a fetch this worker
    // should decline to make.
    expect(pickArtUrl({ image: "http://example.com/insecure.png" })).toBeNull();
  });

  it("refuses anything that is not a document with a picture in it", () => {
    expect(pickArtUrl(null)).toBeNull();
    expect(pickArtUrl({})).toBeNull();
    expect(pickArtUrl({ images: "not-an-array" })).toBeNull();
    expect(pickArtUrl({ images: [{ type: "standard" }] })).toBeNull();
    expect(pickArtUrl({ image: "not a url" })).toBeNull();
    expect(pickArtUrl({ image: 42 })).toBeNull();
  });
});

describe("MIRRORS", () => {
  /**
   * The list is the security boundary — nothing on-chain can add to it — so
   * these assert the shape that makes that true, not the contents.
   */
  it("names only https sources, each with a block it stops at", () => {
    for (const target of MIRRORS) {
      expect(new URL(target.metadata).protocol).toBe("https:");
      expect(target.untilBlock).toBeGreaterThan(0);
      expect(target.asset).toBe(target.asset.toUpperCase());
    }
  });

  it("keeps EVOLVEDPEPE's window inside its launch, plus a settling tail", () => {
    const evolved = MIRRORS.find((m) => m.asset === "EVOLVEDPEPE");
    if (!evolved) return; // removed after the launch settled — nothing to check
    // soft_cap_deadline_block is 965101; the tail catches the final image.
    expect(evolved.untilBlock).toBeGreaterThanOrEqual(965_101);
    expect(evolved.untilBlock).toBeLessThanOrEqual(965_101 + 144);
  });
});
