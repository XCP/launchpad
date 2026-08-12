import { DurableObject } from "cloudflare:workers";
import type { Env } from "#api/env";

/**
 * One singleton room for the whole site — how many people currently have
 * xcp.fun open, anywhere, not per-launch. Traffic here is expected to be low
 * enough that a per-launch count would mostly read 0 or 1, which isn't an
 * interesting number; the site-wide count is. Purely a headcount: no polling,
 * no alarm, no outbound fetches — the only work this room ever does is
 * broadcast a number when someone joins or leaves, so it costs nothing beyond
 * the connections themselves, hibernated the same way as LaunchRoom.
 *
 * PEOPLE, NOT SOCKETS. Counting sockets counted tabs, which inflated the
 * number exactly for the most engaged visitors — someone comparing two
 * launches side by side counted twice. Each client sends an opaque id that is
 * stable across its own tabs, and the count is the number of DISTINCT ids.
 *
 * The id rides on the socket via serializeAttachment rather than an in-memory
 * Map, because this room hibernates: a Map would be lost the moment the room
 * is evicted and every visitor would silently become anonymous. Attachments
 * survive hibernation, which is the whole reason that API exists.
 */

/** Long enough for a UUID, short enough that a hostile client can't use this
 *  room as free storage. */
const MAX_ID_LEN = 64;

export class SitePresence extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    // Send the room's current size to the newcomer alone. They are not in it
    // yet — that happens when their hello arrives — but this means the badge
    // has a number to render from the first frame instead of waiting a round
    // trip, and they simply watch themselves join.
    try {
      server.send(JSON.stringify({ type: "count", count: this.headcount() }));
    } catch {
      // A socket that can't be written to will surface as a close event.
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The only message this room accepts: `{ type: "hello", id }`. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let id: unknown;
    try {
      const parsed = JSON.parse(message) as { type?: unknown; id?: unknown };
      if (parsed.type !== "hello") return;
      id = parsed.id;
    } catch {
      return;
    }
    // Never trust the client's shape. An unusable id leaves the socket
    // anonymous, which headcount() still counts — just not deduplicated.
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LEN) return;
    ws.serializeAttachment(id);
    this.broadcastCount();
  }

  async webSocketClose() {
    this.broadcastCount();
  }

  async webSocketError() {
    this.broadcastCount();
  }

  /**
   * Distinct visitors. A socket that hasn't identified itself yet — or is
   * running a bundle from before this existed — counts as one of its own
   * rather than being dropped, so the number degrades to the old
   * tab-counting behaviour instead of under-reporting.
   */
  private headcount(): number {
    const ids = new Set<string>();
    let anonymous = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const id = ws.deserializeAttachment();
      if (typeof id === "string" && id.length > 0) ids.add(id);
      else anonymous += 1;
    }
    return ids.size + anonymous;
  }

  private broadcastCount() {
    const body = JSON.stringify({ type: "count", count: this.headcount() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        // Reaped on the next close/error event.
      }
    }
  }
}
