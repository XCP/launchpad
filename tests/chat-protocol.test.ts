import { describe, expect, it } from "vitest";
import { CHAT_MAX_CODEPOINTS, CHAT_MAX_LINES, chatHandle, chatLineCount, normalizeChatPost, normalizeChatText, parseChatFrame, type ChatMessage } from "@launchpad/chat";

const message: ChatMessage = { id: "message-123", authorId: "a".repeat(64), handle: "Quiet-Otter-1234", text: "Hello", createdAt: 1_800_000_000_000 };
const compactMessage: ChatMessage = { ...message, handle: chatHandle(message.authorId) };

describe("plain-text chat protocol", () => {
  it.each(["日本語でこんにちは", "你好，世界", "Привіт", "hola 👋", "👩‍💻"])("preserves ordinary Unicode: %s", (text) => {
    expect(normalizeChatText(text)).toBe(text);
  });
  it("counts astral emoji as codepoints rather than UTF-16 units", () => {
    expect(normalizeChatText("😀".repeat(CHAT_MAX_CODEPOINTS))).toBe("😀".repeat(CHAT_MAX_CODEPOINTS));
    expect(normalizeChatText("😀".repeat(CHAT_MAX_CODEPOINTS + 1))).toBeNull();
  });
  it("trims edges and normalizes line endings while preserving internal tabs/newlines", () => {
    expect(normalizeChatText(" \t a\r\nb\rc\t d \n")).toBe("a\nb\nc\t d");
  });
  it.each(["\n", "\r\n", "\r", "\u0085", "\u2028", "\u2029"])("limits meaningful lines after normalizing %j", (separator) => {
    const three = ["a", "b", "c"].join(separator);
    expect(chatLineCount(three)).toBe(CHAT_MAX_LINES);
    expect(normalizeChatText(three)).toBe("a\nb\nc");
    expect(chatLineCount(three + separator + "d")).toBe(4);
    expect(normalizeChatText(three + separator + "d")).toBeNull();
    expect(normalizeChatText(` ${separator}${three}${separator} \t `)).toBe("a\nb\nc");
  });
  it("preserves an interior blank line while ignoring empty edge lines", () => {
    expect(normalizeChatText("\n a\n\nb \n")).toBe("a\n\nb");
    expect(chatLineCount("\n a\n\nb \n")).toBe(3);
    expect(normalizeChatText("a\n\n\nb")).toBeNull();
    expect(chatLineCount(" \n\t ")).toBe(0);
  });
  it.each([null, 5, "", " \n\t", "a\u0000b", "a\u0007b", "a\u007fb", "a\u009fb", "hello\u000b", "\u000chello", "\ud800", "x".repeat(4097), " ".repeat(4096) + "ok"])("rejects empty, oversized or control-bearing input %j", (value) => {
    expect(normalizeChatText(value)).toBeNull();
  });
  it("validates opaque identity and request IDs, returning only allowed fields", () => {
    const input = { requestId: "request-123", authorId: message.authorId, handle: message.handle, text: " Hello ", address: "1RawWalletAddress" };
    expect(normalizeChatPost(input)).toEqual({ requestId: "request-123", authorId: message.authorId, handle: compactMessage.handle, text: "Hello" });
    expect(normalizeChatPost({ ...input, authorId: "1RawWalletAddress" })).toBeNull();
    expect(normalizeChatPost({ ...input, requestId: "../../identity" })).toBeNull();
    expect(normalizeChatPost({ ...input, handle: "<b>admin</b>" })).toBeNull();
  });
  it("treats markup as text rather than a rendering format", () => {
    expect(normalizeChatText('<img src=x onerror="alert(1)">')).toBe('<img src=x onerror="alert(1)">');
  });
  it("parses bounded history and live frames without forwarding extra fields", () => {
    expect(parseChatFrame(JSON.stringify({ type: "message", message: { ...message, address: "secret" } }))).toEqual({ type: "message", message: compactMessage });
    expect(parseChatFrame({ type: "history", messages: [message] })).toEqual({ type: "history", messages: [compactMessage] });
    expect(parseChatFrame({ type: "history", messages: [] })).toEqual({ type: "history", messages: [] });
    expect(parseChatFrame({ type: "history", messages: [message, message] })).toBeNull();
    expect(parseChatFrame({ type: "history", messages: Array.from({ length: 51 }, (_, i) => ({ ...message, id: `message-${i}` })) })).toBeNull();
    expect(parseChatFrame({ type: "message", message: { ...message, createdAt: NaN } })).toBeNull();
    expect(parseChatFrame({ type: "message", message: { ...message, text: " noncanonical " } })).toBeNull();
    expect(parseChatFrame("x".repeat(100001))).toBeNull();
    expect(parseChatFrame("{")).toBeNull();
  });

  it("derives stable compact names across all 32 mascots", () => {
    const handles = Array.from({ length: 32 }, (_, n) => {
      const id = n.toString(16).padStart(2, "0") + "12345" + "0".repeat(57);
      const handle = chatHandle(id);
      expect(chatHandle(id)).toBe(handle);
      expect(handle).toMatch(/^[A-Za-z]+[A-Z2-7]{4}$/);
      expect(handle.length).toBeLessThanOrEqual(10);
      return handle;
    });
    expect(new Set(handles.map((handle) => handle.slice(0, -4))).size).toBe(32);
    expect(chatHandle("0".repeat(64))).toBe("PepeAAAA");
    expect(chatHandle("1f" + "fffff" + "0".repeat(57))).toBe("Mole7777");
    expect(() => chatHandle("bc1qwalletaddress")).toThrow("invalid_chat_author");
  });

  it("accepts bounded socket counts and strips unrelated presence fields", () => {
    expect(parseChatFrame({ type: "history", messages: [], count: 1 })).toEqual({ type: "history", messages: [], count: 1 });
    expect(parseChatFrame({ type: "message", message, count: 500 })).toEqual({ type: "message", message: compactMessage, count: 500 });
    expect(parseChatFrame({ type: "presence", count: 0, address: "secret" })).toEqual({ type: "presence", count: 0 });
    expect(parseChatFrame({ type: "presence" })).toBeNull();
    for (const count of [-1, 501, 1.5, NaN, "1", null]) {
      expect(parseChatFrame({ type: "presence", count })).toBeNull();
      expect(parseChatFrame({ type: "history", messages: [], count })).toBeNull();
      expect(parseChatFrame({ type: "message", message, count })).toBeNull();
    }
  });
});
