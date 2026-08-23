import { describe, expect, it } from "vitest";
import { classifyDescription, proseDescription } from "@launchpad/xcp69/description";

/**
 * The four jobs Counterparty's one description field does, and the wrong
 * answer that made these tests necessary: GENXSIXNINE inscribed a 33 KB
 * text/html mint viewer as its description, the site read "not a URL" as
 * "must be the creator's words", and `<!doctype html><html lang="en">…`
 * became the blockquote on the launch page, the blurb on the card, and the
 * og:description of every link shared to Telegram.
 *
 * Both apps classify through this module, but only the web app still holds
 * the mime_type — D1 stores the description text alone — so every inscribed
 * case is asserted twice: once with the type, once on shape alone.
 */

const HTML_INSCRIPTION =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  "<title>GENXSIXNINE — Mainnet V1</title><style>*{box-sizing:border-box}</style>";

describe("classifyDescription", () => {
  it("reads an inscribed launch as content, not words", () => {
    expect(classifyDescription(HTML_INSCRIPTION, "text/html")).toBe("inscription");
    // The indexer has no mime_type; the opening tag is the tell.
    expect(classifyDescription(HTML_INSCRIPTION)).toBe("inscription");
  });

  it("trusts the mime_type over the shape", () => {
    // An inscribed image arrives as bytes that may decode to anything at
    // all — including something that would otherwise pass for a sentence.
    expect(classifyDescription("a perfectly ordinary sentence", "image/png")).toBe(
      "inscription",
    );
    // Parameters ride along on real mime_types.
    expect(classifyDescription(HTML_INSCRIPTION, "text/html; charset=utf-8")).toBe(
      "inscription",
    );
    // text/plain is what a plain description carries; it decides nothing.
    expect(classifyDescription("Gen X, six nine, one protoform.", "text/plain")).toBe(
      "prose",
    );
  });

  it("spots binary content that arrived as a string", () => {
    expect(classifyDescription("\u0089PNG\r\n\u001a\n\u0000\u0000\u0000")).toBe(
      "inscription",
    );
    // Newlines and tabs are prose punctuation, not a binary tell.
    expect(classifyDescription("One address.\nOne Protoform.\n\tBitcoin decides.")).toBe(
      "prose",
    );
  });

  it("separates pointers from words", () => {
    expect(classifyDescription("https://xcp.fun/GENXSIXNINE.json")).toBe("url");
    expect(classifyDescription("HTTPS://elsewhere.example/meta.json")).toBe("url");
    expect(classifyDescription("One address. One Protoform.")).toBe("prose");
  });

  it("treats absence as absence", () => {
    expect(classifyDescription(null)).toBe("empty");
    expect(classifyDescription(undefined)).toBe("empty");
    expect(classifyDescription("   ")).toBe("empty");
    // An inscription's content is gone but the type still says what it was.
    expect(classifyDescription("", "image/png")).toBe("empty");
  });
});

describe("proseDescription", () => {
  it("yields nothing for anything that is not words", () => {
    expect(proseDescription(HTML_INSCRIPTION, "text/html")).toBe("");
    expect(proseDescription(HTML_INSCRIPTION)).toBe("");
    expect(proseDescription("https://xcp.fun/GENXSIXNINE.json")).toBe("");
    expect(proseDescription(null)).toBe("");
  });

  it("holds the space for real prose only", () => {
    // Too short to be worth a blockquote of its own.
    expect(proseDescription("mint it", "text/plain")).toBe("");
    // The ticker restated is not a description.
    expect(proseDescription("genxsixnine", "text/plain", "GENXSIXNINE")).toBe("");
    expect(proseDescription("  One address. One Protoform.  ", "text/plain")).toBe(
      "One address. One Protoform.",
    );
  });
});
