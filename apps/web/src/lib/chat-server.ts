import { NextResponse } from "next/server";
import { CHAT_MAX_RAW_BYTES } from "@launchpad/chat";

/** Exact, server-configured addresses. A connected-wallet claim is not proof. */
export function isChatAdmin(address: string, configured: unknown): boolean {
  return typeof configured === "string" && configured.split(",").some((entry) => entry.trim() === address);
}

export function chatReply(body: unknown, status: number, retryAfter?: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
    },
  });
}

/** Bound actual bytes, not just Content-Length (which can be absent). */
export async function readChatBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > CHAT_MAX_RAW_BYTES) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
