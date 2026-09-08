import { NextResponse } from "next/server";
import { CHAT_MAX_RAW_BYTES } from "@launchpad/chat";
import { readBoundedBody } from "@/lib/bounded-body";

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
  const body = await readBoundedBody(request, CHAT_MAX_RAW_BYTES);
  // Keep chat's strict UTF-8 validation instead of replacing malformed bytes.
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
