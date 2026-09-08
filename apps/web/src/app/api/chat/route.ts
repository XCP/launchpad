import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isChatRequestId, normalizeChatText, type ChatPost, type ChatPostResult } from "@launchpad/chat";
import { chatReply as reply, readChatBody as readBody, isChatAdmin } from "@/lib/chat-server";
import { chatIdentity } from "@/lib/chat-identity";
import { readCookie, readSession, sameOrigin, SESSION_COOKIE } from "@/lib/session";

// A narrow structural binding type keeps Worker implementation code out of
// the Next bundle. RPC is reachable only by explicitly bound trusted Workers.
interface ChatBinding {
  idFromName(name: string): unknown;
  get(id: unknown): { publish(post: ChatPost): Promise<ChatPostResult> };
}

/** Private to the authenticated browser, so its own handle can be marked in
 * existing history before its first post. No room or chain query is needed. */
export async function GET(request: Request) {
  const address = await readSession(readCookie(request, SESSION_COOKIE));
  if (!address) return reply({ error: "unauthorized" }, 401);
  try {
    const { env } = await getCloudflareContext({ async: true });
    const bindings = env as unknown as { CHAT_HANDLE_SECRET?: string; CHAT_ADMIN_ADDRESSES?: string };
    const secret = bindings.CHAT_HANDLE_SECRET;
    if (!secret) return reply({ error: "unavailable" }, 503);
    return reply({ address, ...await chatIdentity(address, secret), isAdmin: isChatAdmin(address, bindings.CHAT_ADMIN_ADDRESSES) }, 200);
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "unauthorized" }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return reply({ error: "invalid_message" }, 415);
  }
  const address = await readSession(readCookie(request, SESSION_COOKIE));
  if (!address) return reply({ error: "unauthorized" }, 401);

  let data: Record<string, unknown>;
  try {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    data = body as Record<string, unknown>;
  } catch {
    return reply({ error: "invalid_message" }, 400);
  }
  // A cookie for wallet A must never turn a message composed as wallet B into
  // a post by A, even if an account switch races an earlier session response.
  if (data.address !== address) return reply({ error: "session_mismatch" }, 409);
  const text = normalizeChatText(data.text);
  if (text === null || !isChatRequestId(data.requestId)) {
    return reply({ error: "invalid_message" }, 400);
  }
  try {
    const { env } = await getCloudflareContext({ async: true });
    const bindings = env as unknown as { CHAT_ROOM?: ChatBinding; CHAT_HANDLE_SECRET?: string };
    if (!bindings.CHAT_ROOM || !bindings.CHAT_HANDLE_SECRET) return reply({ error: "unavailable" }, 503);
    const identity = await chatIdentity(address, bindings.CHAT_HANDLE_SECRET);
    const room = bindings.CHAT_ROOM.get(bindings.CHAT_ROOM.idFromName("global"));
    // Never forward the address, signature, session cookie or client-supplied
    // name to the room. Identity comes exclusively from the verified session.
    const result = await room.publish({ requestId: data.requestId, ...identity, text });
    if (result.ok) return reply(result, 200);
    const status = result.error === "rate_limited" ? 429 : result.error === "invalid_message" ? 400 : 403;
    return reply({ error: result.error, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) }, status, result.retryAfter);
  } catch {
    // Transient binding errors and missing secrets should not expose internals
    // or silently accept a post. The client retains the draft for retry.
    return reply({ error: "unavailable" }, 503);
  }
}
