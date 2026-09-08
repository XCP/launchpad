import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isChatAuthorId, type ChatBan, type ChatBanResult } from "@launchpad/chat";
import { chatIdentity } from "@/lib/chat-identity";
import { chatReply as reply, isChatAdmin, readChatBody } from "@/lib/chat-server";
import { readCookie, readSession, sameOrigin, SESSION_COOKIE } from "@/lib/session";

interface ModerationEnv {
  CHAT_ADMIN_ADDRESSES?: string;
  CHAT_HANDLE_SECRET?: string;
  CHAT_ROOM?: {
    idFromName(name: string): unknown;
    get(id: unknown): {
      listBans(): Promise<ChatBan[]>;
      setBan(authorId: string, banned: boolean): Promise<ChatBanResult>;
    };
  };
}

async function adminSession(request: Request) {
  const address = await readSession(readCookie(request, SESSION_COOKIE));
  if (!address) return { response: reply({ error: "unauthorized" }, 401) };
  const { env } = await getCloudflareContext({ async: true });
  const bindings = env as unknown as ModerationEnv;
  if (!isChatAdmin(address, bindings.CHAT_ADMIN_ADDRESSES)) return { response: reply({ error: "forbidden" }, 403) };
  if (!bindings.CHAT_ROOM || !bindings.CHAT_HANDLE_SECRET) return { response: reply({ error: "unavailable" }, 503) };
  return { address, bindings, room: bindings.CHAT_ROOM.get(bindings.CHAT_ROOM.idFromName("global")) };
}

/** Only explicit admin UI opens read this bounded list; there is no polling. */
export async function GET(request: Request) {
  try {
    const session = await adminSession(request);
    if (session.response) return session.response;
    return reply({ bans: await session.room!.listBans() }, 200);
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply({ error: "unauthorized" }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply({ error: "invalid_request" }, 415);
  try {
    const session = await adminSession(request);
    if (session.response) return session.response;
    let data: Record<string, unknown>;
    try {
      const body = await readChatBody(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
      data = body as Record<string, unknown>;
    } catch {
      return reply({ error: "invalid_request" }, 400);
    }
    if (data.address !== session.address) return reply({ error: "session_mismatch" }, 409);
    if (!isChatAuthorId(data.authorId) || typeof data.banned !== "boolean") return reply({ error: "invalid_request" }, 400);
    // A stray menu click should not ban the admin's own chat identity.
    const own = await chatIdentity(session.address!, session.bindings!.CHAT_HANDLE_SECRET!);
    if (data.banned && data.authorId === own.authorId) return reply({ error: "invalid_author" }, 400);
    const result = await session.room!.setBan(data.authorId, data.banned);
    return reply(result, result.ok ? 200 : result.error === "ban_limit" ? 409 : 400);
  } catch {
    return reply({ error: "unavailable" }, 503);
  }
}
