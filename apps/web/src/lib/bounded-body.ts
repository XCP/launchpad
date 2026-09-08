/** Reject oversized bodies before a parser allocates the complete payload. */
export class BodyTooLarge extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLarge";
  }
}

/** Content-Length is an early refusal only; streamed bytes enforce the limit. */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid body limit");
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    // Cancellation releases transport; a slow source must not delay the 413.
    void request.body?.cancel().catch(() => undefined);
    throw new BodyTooLarge();
  }
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  let bytes = new Uint8Array(0);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size) throw new BodyTooLarge();
      // Retain one bounded buffer, even if a source sends millions of tiny chunks.
      if (size + value.byteLength > bytes.byteLength) {
        const next = new Uint8Array(Math.min(maxBytes, Math.max(16_384, size + value.byteLength, bytes.byteLength * 2)));
        next.set(bytes);
        bytes = next;
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return bytes.subarray(0, size);
}

export async function boundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBoundedBody(request, maxBytes);
  return new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}

export async function boundedJson(request: Request, maxBytes: number): Promise<unknown> {
  return new Response(await readBoundedBody(request, maxBytes)).json();
}
