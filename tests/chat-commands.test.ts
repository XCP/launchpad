import { describe, expect, it } from "vitest";
import { parseChatCommand, resolveChatAuthor } from "@/lib/chat-commands";

const pepe = { authorId: "a".repeat(64), handle: "PepeABCD" };
const doge = { authorId: "b".repeat(64), handle: "DogeEFGH" };

describe("local chat commands", () => {
  it.each(["/help", "/HELP", "  /Help\t"])("recognizes help: %s", (text) => {
    expect(parseChatCommand(text)).toEqual({ type: "help" });
  });

  it.each([
    ["/mute PepeABCD", "mute", "PepeABCD"],
    ["/mute @PepeABCD", "mute", "PepeABCD"],
    ["/UNMUTE @pepeAbCd", "unmute", "pepeAbCd"],
    [" \t/MuTe\tPepeABCD  ", "mute", "PepeABCD"],
    ["@PepeABCD /mute", "mute", "PepeABCD"],
    ["@pepeAbCd\t/UNMUTE", "unmute", "pepeAbCd"],
    ["/mute Abc", "mute", "Abc"],
    ["/mute A234567890123456", "mute", "A234567890123456"],
  ])("recognizes an exact command and complete handle: %s", (text, type, handle) => {
    expect(parseChatCommand(text)).toEqual({ type, handle });
  });

  it.each([
    "/", "/dance", "/help please", "/mute", "/unmute", "/mute @",
    "/mute @PepeABCD extra", "/mute PepeABCD DogeEFGH", "/mute @@PepeABCD",
    "/mute Ab", "/mute A2345678901234567", "/mute 1Pepe", "/mute Pepe_ABCD",
    "/mute Pepe-ABCD", "/mute PépéABCD", "/mute PepeABCD/anything",
    "/mute @PepeABCD\nhello", "/mute\nPepeABCD", "/help\n", "/help\r",
    "/mute PepeABCD\u2028", "/mute PepeABCD\u0085", "/mute PepeABCD\u2029",
    "@PepeABCD\n/mute", "@PepeABCD /mute\n", "@Ab /mute", "@@PepeABCD /unmute",
  ])("rejects malformed commands without turning them into public messages: %s", (text) => {
    expect(parseChatCommand(text)).toEqual({ type: "invalid" });
  });

  it.each([
    "", "Hello 🐸", "I use /mute for that", "Try /help", "@PepeABCD please /mute",
    "@PepeABCD /mute later", "PepeABCD /mute", "@PepeABCD /help", "https://xcp.fun/mute",
    "First line\n/mute is a command", "hello /mute @PepeABCD",
  ])("keeps ordinary prose ordinary: %s", (text) => {
    expect(parseChatCommand(text)).toBeNull();
  });
});

describe("command author resolution", () => {
  it("resolves case-insensitive handles to their existing opaque identity", () => {
    expect(resolveChatAuthor("@pEpEaBcD", [pepe, doge], [])).toEqual(pepe);
  });

  it("deduplicates repeated messages and a matching saved mute by authorId", () => {
    expect(resolveChatAuthor("PepeABCD", [pepe, pepe, { ...pepe, handle: "PEPEABCD" }], [pepe])).toEqual(pepe);
  });

  it("can unmute an author whose messages have left the recent history", () => {
    expect(resolveChatAuthor("dogeefgh", [pepe], [doge])).toEqual(doge);
  });

  it("refuses a handle collision across different identities, including the saved mute list", () => {
    const collision = { ...doge, handle: "pepeabcd" };
    expect(resolveChatAuthor("PepeABCD", [pepe, collision], [])).toBeNull();
    expect(resolveChatAuthor("PepeABCD", [pepe], [collision])).toBeNull();
  });

  it("never treats an unknown name, partial name or supplied authorId as an identity", () => {
    for (const handle of ["unknown", "Pepe", pepe.authorId, "PepeABCD extra", "@@PepeABCD"]) {
      expect(resolveChatAuthor(handle, [pepe, doge], [])).toBeNull();
    }
  });

  it("returns only identity fields and does not mutate the transcript or saved mutes", () => {
    const message = Object.freeze({ ...pepe, text: "hello", id: "message-id", createdAt: 1 });
    const messages = Object.freeze([message]);
    const muted = Object.freeze([Object.freeze(doge)]);
    expect(resolveChatAuthor("PepeABCD", messages, muted)).toEqual(pepe);
    expect(messages).toEqual([message]);
    expect(muted).toEqual([doge]);
  });
});
