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
  NEAR_MARKS,
  SELL_EMOJI,
  nearingSoldOut,
  blocksEta,
  imageUrl,
  lpBurned,
  mint,
  mintClosed,
  mintClosing,
  mintDigest,
  mintOpen,
  newLaunch,
  sizeBar,
  tokens,
  trade,
  tokenBurned,
  xcp,
} from "#api/telegram/format";
import { eventTxHash } from "#api/telegram/replay";

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

  it("puts per-token XCP price and approximate USD total on a new line", () => {
    const m = trade({
      asset: "A",
      buy: true,
      tokenRaw: raw(500_000n),
      xcpRaw: raw(20n),
      venue: "pool",
      xcpUsd: 2.5,
      launchXcpUsd: 1.25,
      txHash: "ab".repeat(32),
      address: "1KacrYMuQW5eqLbrYUotQ1mdsVpxin6hC9",
    });
    expect(m.text).toContain("0.00004000 XCP/token · $50.00");
    expect(m.text).toContain("MCap: 4,000 XCP · $10,000.00");
    expect(m.text).toContain("Performance: +700.0%");
    expect(m.text).toContain(`https://xcp.io/tx/${"ab".repeat(32)}`);
    expect(m.text).toContain("1KacrY…6hC9");
    expect(m.text).toContain("https://xcp.fun/profile/1KacrYMuQW5eqLbrYUotQ1mdsVpxin6hC9");
    expect(m.text.split("\n").at(-1)).toContain(">Trade</a>");
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

describe("trade transaction links", () => {
  it("uses a pool tx hash directly and the completing half of an order match", () => {
    const tx0 = "12".repeat(32);
    const tx1 = "34".repeat(32);
    expect(eventTxHash(tx0)).toBe(tx0);
    expect(eventTxHash(`${tx0}#20449811`)).toBe(tx0);
    expect(eventTxHash(`${tx0}_${tx1}`)).toBe(tx1);
    expect(eventTxHash("not-a-transaction")).toBeNull();
  });
});

describe("the size bar leads", () => {
  // A channel is read as a column, and the size is what is worth spotting
  // without stopping to read. On the first line the bars align down the left
  // edge and the feed can be scanned by shape alone. This was tried the other
  // way round and moved back, so it is pinned in the direction that won.
  const firstLineOf = (text: string) => text.split("\n")[0]!;

  it("on a mint", () => {
    const m = mint({
      asset: "A",
      earnedRaw: raw(200_000n),
      paidRaw: raw(2n),
      source: "1FUNbtWSVaeUbxRC4cbCXeWiBJHrfxr2FS",
      progress: 0.5,
    });
    expect(firstLineOf(m.text)).toBe(MINT_EMOJI.repeat(4));
  });

  it("on a digest", () => {
    const d = mintDigest("A", 12, raw(300_000n), raw(3n));
    expect(firstLineOf(d.text)).toBe(MINT_EMOJI.repeat(6));
  });

  it("on a buy and a sell", () => {
    const buy = trade({ asset: "A", buy: true, tokenRaw: raw(100_000n), xcpRaw: raw(1n), venue: "pool" });
    const sell = trade({ asset: "A", buy: false, tokenRaw: raw(100_000n), xcpRaw: raw(1n), venue: "pool" });
    expect(firstLineOf(buy.text)).toBe(BUY_EMOJI.repeat(2));
    expect(firstLineOf(sell.text)).toBe(SELL_EMOJI.repeat(2));
  });

  it("with the ticker on the line under it", () => {
    const m = mint({
      asset: "MINTCOIN",
      earnedRaw: raw(100_000n),
      paidRaw: raw(1n),
      source: "x",
      progress: null,
    });
    expect(m.text.split("\n")[1]).toContain("MINTCOIN");
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
    // fb=full is load-bearing, not decoration: without it the route behind
    // this URL falls back to cdn.xcp.io's 48x48 ICON for any launch whose art
    // we do not hold, and Telegram blows that up to the width of the bubble.
    expect(imageUrl("A")).toBe("https://xcp.fun/full/A?fb=full");
    // A version makes replaced art a URL Telegram has not cached.
    expect(imageUrl("A", 'abc"def')).toBe("https://xcp.fun/full/A?fb=full&v=abc%22def");
    expect(imageUrl("A", null)).toBe(imageUrl("A"));
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

describe("the trade bar's visual ceiling", () => {
  it("allows twice the previous maximum", () => {
    const m = trade({
      asset: "A",
      buy: true,
      tokenRaw: raw(10_000_000n),
      xcpRaw: raw(1n),
      venue: "pool",
    });
    expect(m.text.match(new RegExp(BUY_EMOJI, "gu"))).toHaveLength(60);
  });
});

describe("multi-fill trade messages", () => {
  it("shows one filled total, an average price, and market cap at the final fill", () => {
    const m = trade({
      asset: "CAPTAINDAN",
      buy: true,
      tokenRaw: 299_119_856_059_935n,
      xcpRaw: 12_097_813_359n,
      fills: 3,
      marketTokenRaw: 16_107_043_441_048n,
      marketXcpRaw: 730_187_677n,
      venue: "pool",
    });
    expect(m.text).toContain("2,991,199 tokens · 120.98 XCP filled · 3 fills");
    expect(m.text).toContain("Avg 0.00004044 XCP/token");
    expect(m.text).toContain("MCap: 4,533.34 XCP");
    expect(m.text).toContain("Performance: +353.3%");
  });
});

describe("burn announcements", () => {
  it("names the burn address, preserves fractional tokens, and links the source and tx", () => {
    const txHash = "a".repeat(64);
    const message = tokenBurned({
      asset: "NAKAMOTOFUN",
      tokenRaw: 123_456_789n,
      source: "1BurnerAddressExample",
      txHash,
    });

    expect(message.asset).toBe("NAKAMOTOFUN");
    expect(message.text).toContain("NAKAMOTOFUN</b></a> burned");
    expect(message.text).toContain("1.23456789 tokens sent to the Counterparty burn address");
    expect(message.text).toContain("/profile/1BurnerAddressExample");
    expect(message.text).toContain(`https://xcp.io/tx/${txHash}`);
  });

  it("distinguishes a burned LP position from destroyed launch-token supply", () => {
    const txHash = "b".repeat(64);
    const message = lpBurned({
      asset: "CAPTAINDAN",
      lpRaw: 447_213_600_000n,
      source: "1LiquidityLockerExample",
      txHash,
    });

    expect(message.asset).toBe("CAPTAINDAN");
    expect(message.text).toContain("CAPTAINDAN</b></a> LP burned");
    expect(message.text).toContain("4,472.136 LP tokens · liquidity locked forever");
    expect(message.text).not.toContain("CAPTAINDAN</b></a> burned");
    expect(message.text).toContain(`https://xcp.io/tx/${txHash}`);
  });
});

describe("trade performance", () => {
  it("includes XCP's USD move since graduation when both quotes are available", () => {
    const m = trade({
      asset: "A",
      buy: true,
      tokenRaw: raw(500_000n),
      xcpRaw: raw(20n),
      venue: "pool",
      xcpUsd: 1.5,
      launchXcpUsd: 3,
    });
    // Token/XCP is +300%, while XCP/USD halved: dollar performance is +100%.
    expect(m.text).toContain("Performance: +100.0%");
  });

  it("keeps XCP-only performance when an old launch has no USD baseline", () => {
    const m = trade({
      asset: "A",
      buy: true,
      tokenRaw: raw(500_000n),
      xcpRaw: raw(20n),
      venue: "pool",
      xcpUsd: 1.5,
    });
    expect(m.text).toContain("Performance: +300.0%");
  });
});

describe("nearing sold out", () => {
  it("leads with how much is minted and names the pending share", () => {
    const m = nearingSoldOut("A", 90.4, 4.2);
    expect(m.text).toContain("90% minted");
    expect(m.text).toContain("4% more is in the mempool");
    expect(m.text).toContain("6% still open"); // 100 − 90 − 4, from the shown figures
  });

  it("omits mempool copy when nothing is pending", () => {
    const text = nearingSoldOut("A", 92, 0).text;
    expect(text).toContain("8% still open");
    expect(text).not.toContain("pending");
  });

  it("floors the minted share rather than rounding it up", () => {
    // 99.6% announced as "100% minted" beside a live mint button is a worse
    // lie than being half a point pessimistic.
    expect(nearingSoldOut("A", 99.6, 0).text).toContain("99% minted");
  });

  it("never shows a negative remainder when the mempool overshoots", () => {
    const m = nearingSoldOut("A", 96, 9);
    expect(m.text).toContain("0% still open");
    expect(m.text).not.toContain("-");
  });

  it("prints three numbers that add to 100", () => {
    // A reader adds them up. If rounding lets them sum to 99 the bot looks
    // like it cannot count, so the remainder is derived from what is shown.
    for (const [minted, pending] of [
      [90.4, 4.2],
      [75.9, 1.1],
      [99.2, 0.4],
      [80, 12.5],
    ] as const) {
      const t = nearingSoldOut("A", minted, pending).text;
      const nums = [...t.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
      // minted + pending(if shown) + open, where an unshown pending is 0.
      const sum = nums.reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    }
  });

  it("has marks that only ever go up", () => {
    expect([...NEAR_MARKS]).toEqual([...NEAR_MARKS].sort((a, b) => a - b));
  });
});

describe("token quantities are never labelled XCP", () => {
  // The bug this caught in a dry run: soft_cap, hard_cap and earned_quantity
  // are counts of the TOKEN. Printed beside "XCP" they claimed a launch was
  // raising 69,000,000 XCP — more than the asset's entire supply — and it read
  // as plausible because the number had a unit next to it.
  const SOFT_CAP_TOKENS = 6_900_000_000_000_000n; // 69M tokens = 690 XCP

  it("never prints a token count beside XCP", () => {
    // 69,000,000 XCP would be more than the asset's entire supply. Every
    // message that names XCP is checked, because the mistake is one
    // substitution away and looks right.
    const texts = [
      mintClosed({
        asset: "A",
        graduated: true,
        earnedRaw: SOFT_CAP_TOKENS,
        mints: 1,
        minters: 1,
      }).text,
      mintClosing("A", 5, SOFT_CAP_TOKENS, SOFT_CAP_TOKENS).text,
    ];
    for (const t of texts) expect(t).not.toContain("69,000,000 XCP");
  });

  it("reports a full raise as 690 XCP on close", () => {
    const m = mintClosed({
      asset: "A",
      graduated: true,
      earnedRaw: SOFT_CAP_TOKENS,
      mints: 142,
      minters: 69,
    });
    expect(m.text).toContain("690 XCP raised");
  });

  it("counts down the close in XCP too", () => {
    const m = mintClosing("A", 5, SOFT_CAP_TOKENS / 2n, SOFT_CAP_TOKENS);
    expect(m.text).toContain("345 / 690 XCP");
  });

  it("still calls the token amount tokens on a mint", () => {
    // The mint line is the one place both units appear, so it is the one
    // place a mix-up would be invisible.
    const m = mint({
      asset: "A",
      earnedRaw: raw(100_000n),
      paidRaw: 100_000_000n,
      source: "x",
      progress: null,
    });
    expect(m.text).toContain("100,000 tokens");
    expect(m.text).toContain("1 XCP");
  });
});

describe("the spam floor", () => {
  it("is a tenth of an XCP in tokens", () => {
    // 1 XCP mints 100,000 tokens, so this is the same number said two ways.
    expect(MIN_TOKENS).toBe(10_000n);
  });
});
