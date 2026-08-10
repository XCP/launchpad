import { DurableObject } from "cloudflare:workers";
import type { Env } from "#api/env";
import { fetchFairminter } from "#api/integrations/counterparty";

const POLL_MS = 8_000;
const MEMPOOL_BASE = "https://api.counterparty.io:4000/v2";
/** Individual pending rows are for the "who's minting right now" list —
 *  capped so a launch with an unusually large mempool queue can't bloat
 *  every broadcast frame; the aggregate count/quantity below stay exact
 *  regardless of the cap. */
const MAX_PENDING_ROWS = 25;

interface PendingMint {
  tx_hash: string;
  source: string;
  quantity: number | string;
}

interface RoomState {
  status: string;
  earned_quantity: string | number | null;
  paid_quantity: string | number | null;
  pending_count: number;
  pending_quantity: number;
  pending: PendingMint[];
}

type RoomMessage = { type: "state" } & RoomState;

interface MempoolEvent {
  tx_hash: string;
  params: {
    fairminter_tx_hash?: string;
    source?: string;
    earn_quantity?: number | string;
    status?: string;
  };
}

/**
 * One room per launch (Durable Object id = the fairminter's tx_hash), one
 * poll loop shared by every viewer of that launch. This is the efficiency
 * answer to "how do we show live activity without blowing things up":
 * whether 1 person or 1,000 are watching the same launch, the room polls
 * Counterparty exactly once per tick, not once per visitor. Sockets are
 * accepted through the Hibernation API, so a room with viewers who are just
 * idly looking costs nothing between messages — no persistent compute, no
 * per-connection billing. The alarm that drives polling only ever reschedules
 * itself while at least one socket is attached; the moment the last viewer
 * leaves, the room goes fully idle and this costs nothing until someone
 * reconnects.
 *
 * This also replaces what was previously a per-visitor client-side fetch of
 * the ENTIRE global mempool events feed (activity-tabs.tsx's Mempool tab) —
 * every open browser tab was independently pulling up to 1,000 events every
 * 10s and filtering client-side. Centralizing that fetch here means it now
 * happens once per launch, not once per visitor.
 */
export class LaunchRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const txHash = url.searchParams.get("fm");
    if (!txHash) return new Response("missing fm", { status: 400 });

    // First viewer to ever open this room pins which fairminter it polls —
    // every later connection is just a subscriber, never re-asked for it.
    const stored = await this.ctx.storage.get<string>("txHash");
    if (!stored) await this.ctx.storage.put("txHash", txHash);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    await this.ensurePolling();

    return new Response(null, { status: 101, webSocket: client });
  }

  // Viewers never need to send anything, and nothing needs telling when one
  // leaves — the alarm loop just checks getWebSockets().length itself on its
  // next tick and stops rescheduling once nobody's left. A stray keepalive
  // frame or an ungraceful disconnect can't take the room down either way.
  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {}

  private async ensurePolling() {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const sockets = this.ctx.getWebSockets();
    // Nobody's watching — do not reschedule. The room falls fully idle here;
    // the next `fetch()` (a new viewer) is what wakes polling back up.
    if (sockets.length === 0) return;

    const txHash = await this.ctx.storage.get<string>("txHash");
    if (txHash) {
      try {
        const state = await this.poll(txHash);
        if (state) this.broadcast({ type: "state", ...state });
      } catch {
        // Transient Counterparty hiccup — just try again next tick rather
        // than tearing down the room over it.
      }
    }

    await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }

  /** Two small GETs, however many viewers are attached: the confirmed
   *  fairminter row (earned/paid/status — only actually changes at block
   *  boundaries, ~every 10 min) and this launch's slice of the mempool
   *  (pending, unconfirmed mints — the second-to-second activity signal).
   *  This is the same pair of fetches the web app used to run once PER
   *  VISITOR every 10s (LiveProgress, and again independently in the
   *  Mempool tab) — now it runs once per launch, however many are watching. */
  private async poll(txHash: string): Promise<RoomState | null> {
    const [fm, pending] = await Promise.all([
      fetchFairminter(txHash),
      this.fetchPending(txHash),
    ]);
    if (!fm) return null;
    return {
      status: fm.status,
      earned_quantity: fm.earned_quantity,
      paid_quantity: fm.paid_quantity,
      pending_count: pending.length,
      pending_quantity: pending.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0),
      pending: pending.slice(0, MAX_PENDING_ROWS),
    };
  }

  /** Unconfirmed is provisional by design — core validates mempool batches
   *  against confirmed state only, so pending can cumulatively exceed the
   *  remaining supply or never confirm. Filtered to status "valid" and never
   *  allowed to feed any conformance or sold-out determination; it only
   *  foreshadows. Sorted biggest-first, same as the table it replaces. */
  private async fetchPending(txHash: string): Promise<PendingMint[]> {
    try {
      const res = await fetch(`${MEMPOOL_BASE}/mempool/events/NEW_FAIRMINT?limit=1000`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return [];
      const data: { result: MempoolEvent[] } = await res.json();
      return (data.result ?? [])
        .filter(
          (e) => e.params?.fairminter_tx_hash === txHash && e.params?.status === "valid",
        )
        .map((e) => ({
          tx_hash: e.tx_hash,
          source: e.params.source ?? "",
          quantity: e.params.earn_quantity ?? 0,
        }))
        .sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0));
    } catch {
      return [];
    }
  }

  private broadcast(message: RoomMessage) {
    const body = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(body);
      } catch {
        // A dead socket the runtime hasn't reaped yet — next close/error
        // event will drop it from getWebSockets().
      }
    }
  }
}
