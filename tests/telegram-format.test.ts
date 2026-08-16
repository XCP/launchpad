/**
 * The announce feed's wording and size bars.
 *
 * Worth testing because both are silent when wrong: a bar that scales off by a
 * factor of ten still looks like a bar, and a message that says "sold" for a
 * buy still looks like a message. Neither throws.
 */
import { describe, expect, it } from "vitest";
import {
  BUY_EMOJI,
  GRADUATE_EMOJI,
  MINT_EMOJI,
  MIN_TOKENS,
  SELL_EMOJI,
  blocksEta,
  imageUrl,
  mint,
  mintClosed,
  mintClosing,
  mintDigest,
  mintOpen,
  newLaunch,
  sizeBar,
  tokens,
  trade,
  xcp,
} from "#api/telegram/format";

/** Raw units for n whole tokens (8 decimals, as everything here is stored). */
const raw = (n: bigint) => n * 100_000_000n;

describe("sizeBar", () => {
  it("gives two emoji per 100k tokens", () => {
    expect(sizeBar("🟩", raw(100_000n), 10)).toBe("🟩🟩");
    expect(sizeBar("🟩", raw(300_000n), 10)).toBe("🟩🟩🟩🟩🟩🟩");
  });

  it("never renders an empty bar for something worth announcing", () => {
    // A message with no bar at all reads as broken rather than as small.
    expect(sizeBar("🟩", raw(10_000n), 10)).toBe("🟩🟩");
    expect(sizeBar("🟩", 1n, 10)).toBe("🟩🟩");
  });

  it("caps so a whale cannot produce a message Telegram truncates", () => {
    expect(sizeBar("🟩", raw(1_000_000n), 10)).toHaveLength("🟩".length * 20);
    expect(sizeBar("🟩", raw(500_000_000n), 10)).toHaveLength("🟩".length * 20);
    expect(sizeBar("🟢", raw(500_000_000n), 15)).toHaveLength("🟢".length * 30);
  });

  it("counts whole tokens, not raw units", () => {
    // The bug this guards: sizing on raw would make every mint hit the cap,
    // because 100k tokens is 1e13 raw.
    expect(sizeBar("🟩", raw(99_999n), 10)).toBe("🟩🟩");
    expect(sizeBar("🟩", raw(200_000n), 10)).toBe("🟩🟩🟩🟩");
  });
});

describe("amounts", () => {
  it("prints whole tokens grouped, without decimals", () => {
    expect(tokens(raw(1_250_000n))).toBe("1,250,000");
  });

  it("keeps XCP to two decimals", () => {
    // 690 XCP is 6.9e10 raw — the standard's soft cap, and the number this
    // feed says most often, so it is worth spelling out rather than trusting.
    expect(xcp(69_000_000_000n)).toBe("690");
    expect(xcp(123_456_789n)).toBe("1.23");
  });

  it("survives a quantity past 2^53", () => {
    // The standard's hard cap is 1e16 raw. A double would round this.
    expect(tokens(10_000_000_000_000_001n)).toBe("100,000,000");
  });
});

describe("blocksEta", () => {
  it("scales the unit to the distance", () => {
    expect(blocksEta(3)).toBe("~30m");
    expect(blocksEta(12)).toBe("~2h");
    expect(blocksEta(1000)).toBe("~7d");
  });
  it("says now rather than a negative", () => {
    expect(blocksEta(0)).toBe("now");
    expect(blocksEta(-5)).toBe("now");
  });
});

describe("messages", () => {
  it("announces a scheduled launch with when it opens", () => {
    const m = newLaunch({
      asset: "MINTCOIN",
      startBlock: 900_100,
      softCapRaw: 69_000_000_000n,
      hardCapRaw: raw(100_000_000n),
      height: 900_000,
    });
    expect(m.text).toContain("MINTCOIN");
    expect(m.text).toContain("900,100");
    expect(m.text).toContain("~17h");
    expect(m.text).toContain("https://xcp.fun/MINTCOIN");
  });

  it("distinguishes a buy from a sell in both colour and verb", () => {
    const buy = trade({ asset: "A", buy: true, tokenRaw: raw(200_000n), xcpRaw: raw(2n), venue: "pool" });
    const sell = trade({ asset: "A", buy: false, tokenRaw: raw(200_000n), xcpRaw: raw(2n), venue: "book" });
    expect(buy.text).toContain(BUY_EMOJI);
    expect(buy.text).toContain("bought");
    expect(sell.text).toContain(SELL_EMOJI);
    expect(sell.text).toContain("sold");
  });

  it("says graduated and refunded differently", () => {
    const facts = { asset: "A", earnedRaw: raw(690n), mints: 142, minters: 69 };
    expect(mintClosed({ ...facts, graduated: true }).text).toContain("GRADUATED");
    expect(mintClosed({ ...facts, graduated: false }).text).toContain("refunded");
    expect(mintClosed({ ...facts, graduated: false }).text).toContain("repaid");
  });

  it("celebrates a graduation with the wordmark's own emoji", () => {
    const g = mintClosed({
      asset: "A",
      graduated: true,
      earnedRaw: raw(690n),
      mints: 142,
      minters: 69,
    });
    expect(g.text).toContain(GRADUATE_EMOJI);
  });

  it("puts no size bar on a close, in either direction", () => {
    // A 690 XCP raise would be 1,380 mint emoji. The bar makes ONE event
    // legible against its neighbours; the end of hundreds is not that.
    const facts = { asset: "A", earnedRaw: raw(690n), mints: 142, minters: 69 };
    for (const graduated of [true, false]) {
      const t = mintClosed({ ...facts, graduated }).text;
      expect(t).not.toContain(MINT_EMOJI);
      expect(t).not.toContain(BUY_EMOJI);
      expect(t).not.toContain(SELL_EMOJI);
    }
  });

  it("shows progress toward the soft cap on a mint", () => {
    const m = mint({
      asset: "A",
      earnedRaw: raw(100_000n),
      paidRaw: raw(1n),
      source: "1FUNbtWSVaeUbxRC4cbCXeWiBJHrfxr2FS",
      progress: 0.34,
    });
    expect(m.text).toContain("34% to soft cap");
    expect(m.text).toContain("1FUNbt…r2FS");
  });

  it("clamps progress that overshoots rather than printing 103%", () => {
    const m = mint({ asset: "A", earnedRaw: raw(1n), paidRaw: 1n, source: "x", progress: 1.03 });
    expect(m.text).toContain("100% to soft cap");
  });

  it("sizes a digest on the total, not the last mint", () => {
    const d = mintDigest("A", 12, raw(1_000_000n), raw(10n));
    expect(d.text).toContain("12 mints");
    expect(d.text).toContain("1,000,000");
    expect(d.text.match(new RegExp(MINT_EMOJI, "gu"))).toHaveLength(20);
  });

  it("counts down blocks with the right plural", () => {
    expect(mintClosing("A", 1, raw(1n), raw(2n)).text).toContain("1 block ");
    expect(mintClosing("A", 5, raw(1n), raw(2n)).text).toContain("5 blocks");
  });

  it("opens with the asset and a link", () => {
    expect(mintOpen("A").text).toContain("OPEN");
    expect(mintOpen("A").text).toContain("https://xcp.fun/A");
  });
});

describe("token artwork", () => {
  it("hangs every per-token announcement on the launch's own image", () => {
    // The image is what makes this a feed rather than a log, so a message
    // that quietly loses it is a regression nothing else would catch.
    const photos = [
      newLaunch({ asset: "A", startBlock: 1, softCapRaw: 1n, hardCapRaw: 1n, height: 0 }),
      mint({ asset: "A", earnedRaw: raw(1n), paidRaw: 1n, source: "x", progress: null }),
      mintDigest("A", 3, raw(1n), 1n),
      mintOpen("A"),
      mintClosing("A", 5, 1n, 2n),
      mintClosed({ asset: "A", graduated: true, earnedRaw: 1n, mints: 1, minters: 1 }),
      trade({ asset: "A", buy: true, tokenRaw: raw(1n), xcpRaw: 1n, venue: "pool" }),
    ].map((a) => a.photo);
    expect(photos.every((p) => p === imageUrl("A"))).toBe(true);
    expect(imageUrl("A")).toBe("https://xcp.fun/full/A");
  });
});

describe("the mint bar's cap is the standard's own ceiling", () => {
  it("fills exactly at a maximum mint", () => {
    // MAX_MINT_PER_TX is 1,000,000 tokens. The longest bar the feed can show
    // for a mint should be the largest mint the chain will accept — not a
    // number someone picked.
    const max = mint({
      asset: "A",
      earnedRaw: raw(1_000_000n),
      paidRaw: raw(10n),
      source: "x",
      progress: null,
    });
    expect(max.text.match(new RegExp(MINT_EMOJI, "gu"))).toHaveLength(20);
  });
});

describe("the spam floor", () => {
  it("is a tenth of an XCP in tokens", () => {
    // 1 XCP mints 100,000 tokens, so this is the same number said two ways.
    expect(MIN_TOKENS).toBe(10_000n);
  });
});
