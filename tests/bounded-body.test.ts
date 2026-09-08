import { describe, expect, it, vi } from "vitest";
import { BodyTooLarge, boundedJson, readBoundedBody } from "@/lib/bounded-body";

const encode = (text: string) => new TextEncoder().encode(text);
function streamed(chunks: Uint8Array[], headers?: HeadersInit, cancel = vi.fn(() => Promise.resolve())) {
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads < chunks.length) controller.enqueue(chunks[reads++]);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
  return {
    request: new Request("https://xcp.fun/api/session", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit),
    cancel, reads: () => reads,
  };
}

describe("bounded request reading", () => {
  it("accepts exact limits without Content-Length and preserves split UTF-8", async () => {
    const raw = encode('{"name":"😊"}');
    const f = streamed([...raw].map(byte => Uint8Array.of(byte)));
    expect(await boundedJson(f.request, raw.byteLength)).toEqual({ name: "😊" });
    expect(f.cancel).not.toHaveBeenCalled();
  });

  it.each([undefined, { "content-length": "1" }])("rejects actual overflow with headers %j and stops reading", async headers => {
    const f = streamed([encode("1234"), encode("5"), encode("never")], headers);
    await expect(readBoundedBody(f.request, 4)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(f.reads()).toBe(2);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.request.body!.locked).toBe(false);
  });

  it("rejects a declared oversize before pulling a byte", async () => {
    const f = streamed([encode("never")], { "content-length": "99999999999999999999999999999" });
    await expect(readBoundedBody(f.request, 4)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(f.reads()).toBe(0);
    expect(f.cancel).toHaveBeenCalledOnce();
  });

  it("counts bytes, not characters", async () => {
    const f = streamed([encode("😊")]);
    await expect(readBoundedBody(f.request, 3)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it("does not wait for a source whose cancellation never settles", async () => {
    const f = streamed([encode("12345")], undefined, vi.fn(() => new Promise<void>(() => {})));
    await expect(readBoundedBody(f.request, 4)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(f.cancel).toHaveBeenCalledOnce();
  }, 1000);

  it("preserves a transport error and releases the reader", async () => {
    const error = new Error("transport failed");
    const request = new Request("https://xcp.fun", {
      method: "POST", duplex: "half", body: new ReadableStream({ pull() { throw error; } }),
    } as RequestInit);
    await expect(readBoundedBody(request, 4)).rejects.toBe(error);
    expect(request.body!.locked).toBe(false);
  });

  it("handles many tiny chunks, empty chunks, and an empty body", async () => {
    const f = streamed([new Uint8Array(), ...Array.from({length: 20_000}, () => Uint8Array.of(42))]);
    const bytes = await readBoundedBody(f.request, 20_000);
    expect(bytes.byteLength).toBe(20_000);
    expect(bytes.every(byte => byte === 42)).toBe(true);
    expect(await readBoundedBody(new Request("https://xcp.fun"), 0)).toEqual(new Uint8Array());
  });
});
