import { DurableObject } from "cloudflare:workers";
import type { Env } from "#api/env";

/**
 * One singleton room for the whole site — how many browser tabs currently
 * have xcp.fun open, anywhere, not per-launch. Traffic here is expected to
 * be low enough that a per-launch count would mostly read 0 or 1, which
 * isn't an interesting number; the site-wide count is. Purely a headcount:
 * no polling, no alarm, no outbound fetches — the only work this room ever
 * does is broadcast a number when someone connects or disconnects, so it
 * costs nothing beyond the connections themselves, hibernated the same way
 * as LaunchRoom.
 */
export class SitePresence extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.broadcastCount();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose() {
    this.broadcastCount();
  }

  async webSocketError() {
    this.broadcastCount();
  }

  async webSocketMessage() {}

  private broadcastCount() {
    const count = this.ctx.getWebSockets().length;
    const body = JSON.stringify({ type: "count", count });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        // Reaped on the next close/error event.
      }
    }
  }
}
