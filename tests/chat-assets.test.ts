import { describe, expect, it } from "vitest";
import { chatAssetIndex, parseChatCashtags } from "@/lib/chat-assets";

describe("standalone chat cashtags", () => {
  it("preserves spelling, punctuation and UTF-16 slice offsets", () => {
    const text = "🐸 ($pepe), $FEWGOODMAN! and $DOGE.";
    const tags = parseChatCashtags(text);
    expect(tags.map(({ tag, asset }) => [tag, asset])).toEqual([
      ["$pepe", "PEPE"], ["$FEWGOODMAN", "FEWGOODMAN"], ["$DOGE", "DOGE"],
    ]);
    for (const tag of tags) expect(text.slice(tag.start, tag.end)).toBe(tag.tag);
    let cursor = 0;
    const reconstructed = tags.map((tag) => {
      const part = text.slice(cursor, tag.start) + tag.tag; cursor = tag.end; return part;
    }).join("") + text.slice(cursor);
    expect(reconstructed).toBe(text);
  });

  it.each([
    "$PEPEMORETHANTWELVE", "$PEPE123", "$PEPE_more", "$PEPE-WORD", "$PEPE猫", "猫$PEPE",
    "$PARENT.child", "$PARENT.child.subchild", "$A95428956661682177", "$ABCD", "$BTC", "$123",
    "https://site.test/$PEPE", "https://site.test?q=$PEPE", "https://site.test/#($PEPE)",
    "ftp://site.test/($PEPE)", "data:text/plain,$PEPE", "$PEPE\u200dMORE",
    "www.example.test/$PEPE", "mailto:$PEPE@example.test", "$PEPE@example.test", "person$PEPE@example.test",
    "\\$PEPE", "$$PEPE", "<a title='$PEPE'>", "&lt;a title=&quot;$PEPE&quot;&gt;", "`$PEPE`",
  ])("does not partially link an identifier, URL, email or literal markup: %s", (text) => {
    expect(parseChatCashtags(text)).toEqual([]);
  });

  it("bounds its work on malformed oversized input", () => {
    expect(parseChatCashtags("$PEPE ".repeat(1000))).toEqual([]);
    expect(parseChatCashtags("$PEPE ".repeat(100))).toHaveLength(64);
  });

  it("recognizes the explicit XCP exception without linking a prefix of another token", () => {
    const tags = parseChatCashtags("$XCP, ($xcp). $XCPMORE $XCP123 $XCP.child");
    expect(tags.map(({ tag, asset }) => [tag, asset])).toEqual([
      ["$XCP", "XCP"], ["$xcp", "XCP"], ["$XCPMORE", "XCPMORE"],
    ]);
  });
});

describe("known launch destinations", () => {
  it("links only canonical supported names returned by the index", () => {
    const index = chatAssetIndex([
      { asset: "PEPE", asset_longname: null }, { asset: "FEWGOODMAN", asset_longname: null },
      { asset: "A95428956661682177", asset_longname: "PARENT.child" },
      { asset: "PARENT.child", asset_longname: null }, { asset: "../profile" }, { asset: "//evil.test" },
      { asset: "https://evil.test" }, { asset: "PEPE?next=evil" }, { asset: "PEPE#part" },
      { asset: "PEPE%2Felsewhere" }, { asset: "pepe" }, { asset: "PEPE\n" }, { asset: "PEPE\u2028" },
      { asset: "" }, null, {}, { asset: 123 },
    ]);
    expect([...index]).toEqual([["PEPE", "/PEPE"], ["FEWGOODMAN", "/FEWGOODMAN"]]);
    expect(index.has("PARENT")).toBe(false); expect(index.has("UNKNOWN")).toBe(false);
  });

  it("does not treat a display longname as an independent membership record", () => {
    expect([...chatAssetIndex([{ asset: "PEPE", asset_longname: "OTHER" }])]).toEqual([["PEPE", "/PEPE"]]);
  });

  it.each([null, undefined, {}, "PEPE"])("fails closed on a malformed index: %j", (value) => {
    expect(chatAssetIndex(value).size).toBe(0);
  });
});
