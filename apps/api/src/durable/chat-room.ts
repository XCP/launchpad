import { DurableObject } from "cloudflare:workers";
import { CHAT_COOLDOWN_MS, CHAT_MAX_BANS, CHAT_MAX_CONNECTIONS, CHAT_MAX_MESSAGES, CHAT_TTL_MS, chatHandle, isChatAuthorId, normalizeChatPost, type ChatBan, type ChatBanResult, type ChatFrame, type ChatMessage, type ChatPost, type ChatPostResult } from "@launchpad/chat";
import type { Env } from "#api/env";
import { closeWebSocket } from "#api/durable/websocket";

const PRESENCE_INTERVAL_MS = 5_000;
const GLOBAL_WINDOW_MS = 10_000;
const GLOBAL_MAX_POSTS = 20;
/** Retry receipts contain no text and have a bounded lifetime and row count. */
const MAX_RECEIPTS = 2_048;

type MessageRow = { id: string; author_id: string; handle: string; text: string; created_at: number };
type ReceiptRow = { message_id: string; created_at: number; digest: string };
type BanRow = { author_id: string; created_at: number };
const banFromRow = (row: BanRow): ChatBan => ({ authorId: row.author_id, handle: chatHandle(row.author_id), createdAt: row.created_at });
const messageFromRow = (row: MessageRow): ChatMessage => ({
  id: row.id, authorId: row.author_id, handle: chatHandle(row.author_id), text: row.text, createdAt: row.created_at,
});

/**
 * One shared text stream. Public sockets can only read; publish is private
 * DO RPC, called by the web worker after it verifies the session and origin.
 * No market polling, upstream calls, wallet addresses, or client identity.
 */
export class ChatRoom extends DurableObject<Env> {
  private cleanupQueue: Promise<void> = Promise.resolve();
  private presenceLastSentAt = 0;
  private presenceLastCount: number | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
        author_id TEXT NOT NULL, handle TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chat_receipts (
        author_id TEXT NOT NULL, request_id TEXT NOT NULL, message_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY (author_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS chat_receipts_created ON chat_receipts(created_at);
      CREATE INDEX IF NOT EXISTS chat_receipts_author ON chat_receipts(author_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS chat_bans (author_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    `);
    if (env.CHAT_ENABLED !== "true") this.closeReaders();
  }

  async fetch(request: Request): Promise<Response> {
    if (this.env.CHAT_ENABLED !== "true") {
      this.closeReaders();
      return new Response("chat disabled", { status: 503 });
    }
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket upgrade", { status: 426 });
    if (this.readers().length >= CHAT_MAX_CONNECTIONS) return new Response("chat busy", { status: 503, headers: { "Retry-After": "30" } });

    this.ctx.storage.transactionSync(() => this.pruneExpired(Date.now()));
    const cleanup = this.scheduleCleanup();
    const [client, server] = Object.values(new WebSocketPair());
    // No await between joining and the history frame. A concurrent publish
    // can only precede this snapshot or follow it with a live frame.
    this.ctx.acceptWebSocket(server);
    try {
      server.send(JSON.stringify({ type: "history", messages: this.history(), count: this.readers().length } satisfies ChatFrame));
      this.publishPresence(server);
      await cleanup;
    } catch {
      closeWebSocket(server, 1011, "chat unavailable");
      this.publishPresence();
      return new Response("chat unavailable", { status: 503 });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Trusted binding only. No HTTP route or WebSocket handler invokes this. */
  async publish(input: ChatPost): Promise<ChatPostResult> {
    if (this.env.CHAT_ENABLED !== "true") { this.closeReaders(); return { ok: false, error: "disabled" }; }
    const post = normalizeChatPost(input);
    if (!post) return { ok: false, error: "invalid_message" };
    if ((this.env.CHAT_MUTED_AUTHORS ?? "").split(",").some((id) => id.trim() === post.authorId)) return { ok: false, error: "muted" };
    // The digest lets a retry reconstruct its original response after the
    // visible message was capped, without retaining another copy of its text.
    // Labels are cosmetic, so only text participates in retry identity.
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(post.text));
    const digest = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const now = Date.now();
    let fresh = false;
    const result = this.ctx.storage.transactionSync<ChatPostResult>(() => {
      // Check after hashing and before retries too: a moderator can ban an
      // author while their earlier request is awaiting its digest.
      if (this.ban(post.authorId)) return { ok: false, error: "banned" };
      this.pruneExpired(now);
      const prior = this.ctx.storage.sql.exec<ReceiptRow>(
        "SELECT message_id, created_at, digest FROM chat_receipts WHERE author_id = ? AND request_id = ?", post.authorId, post.requestId,
      ).toArray()[0];
      if (prior) return prior.digest === digest
        ? { ok: true, message: { id: prior.message_id, authorId: post.authorId, handle: post.handle, text: post.text, createdAt: prior.created_at } }
        : { ok: false, error: "invalid_message" };

      const sender = this.ctx.storage.sql.exec<{ created_at: number }>(
        "SELECT created_at FROM chat_receipts WHERE author_id = ? ORDER BY created_at DESC LIMIT 1", post.authorId,
      ).toArray()[0];
      if (sender && now - sender.created_at < CHAT_COOLDOWN_MS) return {
        ok: false, error: "rate_limited", retryAfter: Math.ceil((sender.created_at + CHAT_COOLDOWN_MS - now) / 1_000),
      };
      // Fifty retained messages exceed the twenty-message global window, so
      // capping history can never erase a still-relevant global rate entry.
      const recent = this.ctx.storage.sql.exec<{ count: number; oldest: number | null }>(
        "SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM chat_messages WHERE created_at > ?", now - GLOBAL_WINDOW_MS,
      ).one();
      if (recent.count >= GLOBAL_MAX_POSTS) return {
        ok: false, error: "rate_limited", retryAfter: Math.ceil(((recent.oldest ?? now) + GLOBAL_WINDOW_MS - now) / 1_000),
      };
      const message: ChatMessage = { id: crypto.randomUUID(), authorId: post.authorId, handle: post.handle, text: post.text, createdAt: now };
      this.ctx.storage.sql.exec("INSERT INTO chat_messages (id, author_id, handle, text, created_at) VALUES (?, ?, ?, ?, ?)",
        message.id, message.authorId, message.handle, message.text, message.createdAt);
      this.ctx.storage.sql.exec("INSERT INTO chat_receipts (author_id, request_id, message_id, created_at, digest) VALUES (?, ?, ?, ?, ?)",
        post.authorId, post.requestId, message.id, now, digest);
      this.pruneCaps();
      fresh = true;
      return { ok: true, message };
    });
    const cleanup = this.scheduleCleanup();
    // There is no await between the committed decision and its broadcast,
    // preserving publication order even when several RPC calls arrive at once.
    if (fresh && result.ok) this.broadcast({ type: "message", message: result.message });
    await cleanup;
    return result;
  }

  /** Private bindings only; the web worker verifies the administrator session. */
  async listBans(): Promise<ChatBan[]> {
    return this.ctx.storage.sql.exec<BanRow>("SELECT author_id, created_at FROM chat_bans ORDER BY created_at, author_id").toArray().map(banFromRow);
  }

  async setBan(authorId: string, banned: boolean): Promise<ChatBanResult> {
    if (!isChatAuthorId(authorId) || typeof banned !== "boolean") return { ok: false, error: "invalid_author" };
    return this.ctx.storage.transactionSync<ChatBanResult>(() => {
      const existing = this.ban(authorId);
      if (banned && existing) return { ok: true, authorId, banned: true, ban: banFromRow(existing) };
      if (!banned) {
        if (existing) this.ctx.storage.sql.exec("DELETE FROM chat_bans WHERE author_id = ?", authorId);
        return { ok: true, authorId, banned: false, ban: null };
      }
      const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM chat_bans").one().count;
      if (count >= CHAT_MAX_BANS) return { ok: false, error: "ban_limit" };
      const createdAt = Date.now();
      this.ctx.storage.sql.exec("INSERT INTO chat_bans (author_id, created_at) VALUES (?, ?)", authorId, createdAt);
      return { ok: true, authorId, banned: true, ban: { authorId, handle: chatHandle(authorId), createdAt } };
    });
  }

  private ban(authorId: string): BanRow | undefined {
    return this.ctx.storage.sql.exec<BanRow>("SELECT author_id, created_at FROM chat_bans WHERE author_id = ?", authorId).toArray()[0];
  }

  webSocketMessage(ws: WebSocket, _message: string | ArrayBuffer) {
    // Protocol ping/pong is handled by the runtime. Application frames have
    // no write capability, including a frame shaped exactly like ChatPost.
    closeWebSocket(ws, 1008, "read only");
    this.publishPresence();
  }
  webSocketClose(ws: WebSocket, code: number, reason: string) { closeWebSocket(ws, code, reason); this.publishPresence(); }
  webSocketError(ws: WebSocket) { closeWebSocket(ws, 1011, "WebSocket error"); this.publishPresence(); }

  async alarm() {
    const before = this.history().length;
    this.ctx.storage.transactionSync(() => this.pruneExpired(Date.now()));
    const cleanup = this.scheduleCleanup();
    if (this.env.CHAT_ENABLED !== "true") this.closeReaders();
    else if (this.history().length !== before) this.broadcast({ type: "history", messages: this.history() });
    await cleanup;
  }

  private history(): ChatMessage[] {
    return this.ctx.storage.sql.exec<MessageRow>("SELECT id, author_id, handle, text, created_at FROM chat_messages ORDER BY seq").toArray().map(messageFromRow);
  }

  private pruneExpired(now: number) {
    this.ctx.storage.sql.exec("DELETE FROM chat_messages WHERE created_at <= ?", now - CHAT_TTL_MS);
    this.ctx.storage.sql.exec("DELETE FROM chat_receipts WHERE created_at <= ?", now - CHAT_TTL_MS);
  }

  private pruneCaps() {
    // Only an accepted insert can increase these counts. Reads and rejected
    // posts need expiry cleanup, never a walk through all retained receipts.
    this.ctx.storage.sql.exec("DELETE FROM chat_messages WHERE seq IN (SELECT seq FROM chat_messages ORDER BY seq DESC LIMIT -1 OFFSET ?)", CHAT_MAX_MESSAGES);
    this.ctx.storage.sql.exec("DELETE FROM chat_receipts WHERE rowid IN (SELECT rowid FROM chat_receipts ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)", MAX_RECEIPTS);
  }

  private scheduleCleanup(): Promise<void> {
    const messages = this.ctx.storage.sql.exec<{ oldest: number | null }>(
      "SELECT MIN(created_at) AS oldest FROM chat_messages",
    ).one().oldest;
    // A direct MIN uses the existing receipt timestamp index. MIN over a
    // UNION scanned every retained receipt each time someone opened chat.
    const receipts = this.ctx.storage.sql.exec<{ oldest: number | null }>(
      "SELECT MIN(created_at) AS oldest FROM chat_receipts",
    ).one().oldest;
    const oldest = messages === null ? receipts : receipts === null ? messages : Math.min(messages, receipts);
    const desired = oldest === null ? null : oldest + CHAT_TTL_MS;
    // Capture the SQL decision now, then apply decisions in event order. The
    // durable alarm remains the source of truth after hibernation, and an
    // older empty read cannot delete a newer post's cleanup alarm.
    const update = this.cleanupQueue.then(async () => {
      const current = await this.ctx.storage.getAlarm();
      if (current === desired) return;
      if (desired === null) await this.ctx.storage.deleteAlarm();
      else await this.ctx.storage.setAlarm(desired);
    });
    // Report this failure to its caller without blocking later repair/retry.
    this.cleanupQueue = update.catch(() => {});
    return update;
  }

  private broadcast(frame: ChatFrame) {
    const readers = this.readers();
    frame = { ...frame, count: readers.length };
    this.clearPresenceTimer();
    this.presenceLastCount = readers.length;
    this.presenceLastSentAt = Date.now();
    const body = JSON.stringify(frame);
    for (const ws of readers) {
      try { ws.send(body); } catch { closeWebSocket(ws, 1011, "chat unavailable"); }
    }
  }
  private readers(): WebSocket[] { return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1); }

  private publishPresence(joining?: WebSocket) {
    const readers = this.readers();
    const now = Date.now();
    if (!readers.length || readers.length === this.presenceLastCount || this.env.CHAT_ENABLED !== "true") {
      this.clearPresenceTimer();
      if (!readers.length) this.presenceLastCount = 0;
      return;
    }
    const delay = this.presenceLastSentAt + PRESENCE_INTERVAL_MS - now;
    if (delay > 0) {
      if (this.presenceTimer === null) this.presenceTimer = setTimeout(() => {
        this.presenceTimer = null;
        this.publishPresence();
      }, delay);
      return;
    }
    this.clearPresenceTimer();
    this.presenceLastCount = readers.length;
    this.presenceLastSentAt = now;
    // One trailing flush settles a quiet room within five seconds. No timer
    // remains once the changed count has been delivered.
    const body = JSON.stringify({ type: "presence", count: readers.length } satisfies ChatFrame);
    for (const ws of readers) {
      if (ws === joining) continue; // Its initial history already has the count.
      try { ws.send(body); } catch { closeWebSocket(ws, 1011, "chat unavailable"); }
    }
  }
  private clearPresenceTimer() {
    if (this.presenceTimer !== null) clearTimeout(this.presenceTimer);
    this.presenceTimer = null;
  }
  private closeReaders() {
    this.clearPresenceTimer();
    for (const ws of this.ctx.getWebSockets()) closeWebSocket(ws, 1008, "chat disabled");
  }
}
