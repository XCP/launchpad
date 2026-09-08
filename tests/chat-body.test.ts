import { describe, expect, it, vi } from "vitest";
import { CHAT_MAX_RAW_BYTES } from "@launchpad/chat";
import { BodyTooLarge } from "@/lib/bounded-body";
import { readChatBody } from "@/lib/chat-server";

function request(chunks: Uint8Array[], headers?: HeadersInit, cancel = vi.fn(() => Promise.resolve())) {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  return {
    value: new Request("https://xcp.fun/api/chat", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit),
    cancel, reads: () => index,
  };
}

describe("shared chat request boundary", () => {
  it("retains split UTF-8 and accepts the exact chat byte limit", async () => {
    const text = JSON.stringify({ text: "🐸", padding: "x".repeat(CHAT_MAX_RAW_BYTES - 28) });
    const bytes = new TextEncoder().encode(text);
    expect(bytes.byteLength).toBe(CHAT_MAX_RAW_BYTES);
    const body = request([...bytes].map((byte) => Uint8Array.of(byte)));
    expect(await readChatBody(body.value)).toEqual(JSON.parse(text));
    expect(body.value.body!.locked).toBe(false);
  });

  it("refuses streamed overflow without waiting for cancellation and releases the reader", async () => {
    const body = request([new Uint8Array(CHAT_MAX_RAW_BYTES + 1)], undefined, vi.fn(() => new Promise<void>(() => {})));
    await expect(readChatBody(body.value)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(body.value.body!.locked).toBe(false);
  }, 1000);

  it("refuses a declared overflow before reading a chunk", async () => {
    const body = request([new TextEncoder().encode("{}")], { "content-length": String(CHAT_MAX_RAW_BYTES + 1) });
    await expect(readChatBody(body.value)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(body.reads()).toBe(0);
    expect(body.cancel).toHaveBeenCalledOnce();
  });

  it("still rejects malformed UTF-8 instead of changing its message content", async () => {
    const prefix = new TextEncoder().encode('{"text":"');
    const suffix = new TextEncoder().encode('"}');
    const body = request([prefix, Uint8Array.of(0xff), suffix]);
    await expect(readChatBody(body.value)).rejects.toThrow();
    expect(body.value.body!.locked).toBe(false);
  });
});
