import { DurableObject } from "cloudflare:workers";
import { compareRawDesc, sumRaw } from "@launchpad/xcp69/numeric";
import type { Env } from "#api/env";
import { fetchFairminter } from "#api/integrations/counterparty";

/** Was 8s. A room polls Counterparty on behalf of everyone watching that
 *  launch, so this is a per-LAUNCH cost, not a per-viewer one — but it is
 *  still someone else's public node, and a busy day means many rooms awake at
 *  once. 15s is most of the way to the same "it updates while I watch" feel
 *  for roughly half the requests, which is a good trade to have already made
 *  before a launch is the reason anyone notices. */
const POLL_MS = 15_000;
/** Confirmed trades can only change when a block lands (~10 min), so they ride
 *  a slower cadence than the mempool does. Polling them every tick would be
 *  three-quarters wasted requests for information that cannot have moved. */
const TRADES_MS = 24_000;
/** Enough tape to fill the visible table; the client paginates locally. */
const MAX_TRADES = 50;
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

/** A confirmed fill on the pair, from either venue. */
interface RoomTrade {
  key: string;
  block: number;
  time: number;
  buy: boolean;
  token_quantity: string;
  xcp_quantity: string;
  address: string;
  venue: "pool" | "book";
  tx_hash: string;
}

interface RoomState {
  status: string;
  earned_quantity: string | number | null;
  paid_quantity: string | number | null;
  pending_count: number;
  /** Raw token units queued, as a string — see the sum that builds it. */
  pending_quantity: string;
  pending: PendingMint[];
  /** Present once the launch has graduated and a market exists. Omitted
   *  while minting, when there is nothing to trade. */
  trades?: RoomTrade[];
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
  /**
   * The last state this room broadcast, kept so a socket does not have to
   * wait out the poll cycle to see anything.
   *
   * In memory AND in storage. Memory is what makes the common case free, but
   * a hibernating object can be evicted between alarms and lose it — and the
   * viewer arriving right after that eviction is precisely the one this
   * exists for. Storage survives; the write below is guarded so it only
   * happens when the state actually moved.
   */
  private last: RoomState | null = null;
  private lastEncoded: string | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const txHash = url.searchParams.get("fm");
    if (!txHash) return new Response("missing fm", { status: 400 });
    // The room is keyed by asset (idFromName), but polling the market needs
    // the ticker itself, so it is pinned alongside the fairminter.
    const asset = url.pathname.split("/").filter(Boolean).pop()?.toUpperCase();
    if (asset && !(await this.ctx.storage.get<string>("asset"))) {
      await this.ctx.storage.put("asset", asset);
    }

    // First viewer to ever open this room pins which fairminter it polls —
    // every later connection is just a subscriber, never re-asked for it.
    const stored = await this.ctx.storage.get<string>("txHash");
    if (!stored) await this.ctx.storage.put("txHash", txHash);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    await this.ensurePolling();

    /**
     * Answer immediately, rather than at the next tick.
     *
     * Nothing here used to send a frame on connect: state only ever reached a
     * viewer from the alarm, so joining a room that was already polling meant
     * waiting out the REST of somebody else's 15 second cycle before the page
     * showed anything live. Measured against production, a socket opened in
     * 286ms and then sat silent for 9 seconds.
     *
     * The room already knows the answer by then — it polled moments ago — so
     * this is not a fresher fetch, just the answer it is already holding,
     * handed over on arrival. A cold room has nothing to replay and does not
     * need it: ensurePolling above set its alarm to fire immediately.
     */
    const known = this.last ?? (await this.ctx.storage.get<RoomState>("last")) ?? null;
    if (known) {
      this.last = known;
      server.send(JSON.stringify({ type: "state", ...known } satisfies RoomMessage));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Viewers never need to send anything, and nothing needs telling when one
  // leaves — the alarm loop just checks getWebSockets().length itself on its
  // next tick and stops rescheduling once nobody's left. A stray keepalive
  // frame or an ungraceful disconnect can't take the room down either way.
  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {}

  /**
   * Keep the latest state for replay, writing only when it changed.
   *
   * A tick that finds nothing new — which is most of them, since these values
   * only move when someone mints or a block lands — costs no write at all.
   */
  private async remember(state: RoomState) {
    const encoded = JSON.stringify(state);
    if (encoded === this.lastEncoded) return;
    this.lastEncoded = encoded;
    this.last = state;
    await this.ctx.storage.put("last", state);
  }

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
        if (state) {
          this.broadcast({ type: "state", ...state });
          await this.remember(state);
        }
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
    const fm = await fetchFairminter(txHash);
    if (!fm) return null;

    // Closed means the sale is over: no more mints can enter the mempool, so
    // that fetch is skipped entirely and the market is watched instead. The
    // two phases never both cost a request.
    const closed = fm.status === "closed";
    const pending = closed ? [] : await this.fetchPending(txHash);
    const trades = closed ? await this.tradesIfDue() : undefined;

    return {
      status: fm.status,
      earned_quantity: fm.earned_quantity,
      paid_quantity: fm.paid_quantity,
      pending_count: pending.length,
      // sumRaw, not a Number reduce. These are token earn amounts, and a
      // launch's hard cap is 1e16 — above 2^53, where the gap between
      // representable integers is 2. A queue of large mints could therefore
      // total to a number that is quietly off, on a figure the page presents
      // as exact. A string on the wire for the same reason every other
      // quantity in this repo is one.
      pending_quantity: sumRaw(pending.map((p) => p.quantity)).toString(),
      pending: pending.slice(0, MAX_PENDING_ROWS),
      ...(trades ? { trades } : {}),
    };
  }

  /** Cached between ticks so the tape refreshes on its own slower clock. The
   *  cache lives on the instance: if the runtime evicts it, the cost is one
   *  extra fetch, never a wrong answer. */
  private tradeCache: { at: number; trades: RoomTrade[] } | null = null;

  private async tradesIfDue(): Promise<RoomTrade[] | undefined> {
    const now = Date.now();
    if (this.tradeCache && now - this.tradeCache.at < TRADES_MS) {
      return this.tradeCache.trades;
    }
    const asset = await this.ctx.storage.get<string>("asset");
    if (!asset) return undefined;
    const trades = await this.fetchTrades(asset);
    this.tradeCache = { at: now, trades };
    return trades;
  }

  /**
   * Both venues. Orders here interleave between the pool and the order book,
   * so a tape built from pool fills alone silently omits real trades at real
   * prices. `forward_asset` is what the row's primary address receives, which
   * is what makes the token arriving a buy.
   */
  private async fetchTrades(asset: string): Promise<RoomTrade[]> {
    const encoded = encodeURIComponent(asset);
    const grab = async (path: string) => {
      try {
        const res = await fetch(`${MEMPOOL_BASE}${path}`, {
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return [];
        return ((await res.json()) as { result: Record<string, unknown>[] }).result ?? [];
      } catch {
        return [];
      }
    };

    const [poolRows, bookRows] = await Promise.all([
      grab(`/pools/${encoded}/XCP/matches?verbose=true&limit=${MAX_TRADES}`),
      grab(`/orders/${encoded}/XCP/matches?verbose=true&status=completed&limit=${MAX_TRADES}`),
    ]);

    const shape = (
      r: Record<string, unknown>,
      venue: "pool" | "book",
    ): RoomTrade | null => {
      const forwardIsToken = r.forward_asset === asset;
      const token = String(forwardIsToken ? r.forward_quantity : r.backward_quantity);
      const xcp = String(forwardIsToken ? r.backward_quantity : r.forward_quantity);
      const address = String(
        (venue === "pool" ? r.source : r.tx1_address) ?? "",
      );
      const txHash = String(r.tx_hash ?? r.tx1_hash ?? r.id ?? "");
      if (!txHash) return null;
      return {
        key: `${venue}-${txHash}-${asset}`,
        block: Number(r.block_index) || 0,
        time: Number(r.block_time) || 0,
        buy: forwardIsToken,
        token_quantity: token,
        xcp_quantity: xcp,
        address,
        venue,
        tx_hash: txHash,
      };
    };

    return [
      ...poolRows
        .filter((r) => r.status === "valid")
        .map((r) => shape(r, "pool")),
      ...bookRows.map((r) => shape(r, "book")),
    ]
      .filter((t): t is RoomTrade => t !== null)
      .sort((a, b) => b.block - a.block || b.time - a.time)
      .slice(0, MAX_TRADES);
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
        // compareRawDesc compares digits; subtracting two Numbers would first
        // round both onto the same value at 1e16 magnitudes and then return 0,
        // silently ordering the largest mints arbitrarily.
        .sort((a, b) => compareRawDesc(a.quantity, b.quantity));
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
