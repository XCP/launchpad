import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as protocol from "@launchpad/chat";
import type { ChatBan, ChatBanResult, ChatFrame, ChatPost, ChatPostResult } from "@launchpad/chat";
import { closeWebSocket } from "../apps/api/src/durable/websocket";

// Execute the actual DO class and SQL against SQLite. Only Cloudflare's base
// class/transport/alarm boundary is replaced; no message or limit logic is.
const source = readFileSync(new URL("../apps/api/src/durable/chat-room.ts", import.meta.url), "utf8")
  .replace(/^import .*;\r?$/gm, "").replace("export class ChatRoom", "class ChatRoom");
const compiled = transformSync(source, { loader: "ts", target: "es2022" }).code;

class Socket {
  frames: ChatFrame[] = [];
  closed = false;
  get readyState() { return this.closed ? 3 : 1; }
  close = vi.fn((_code: number, _reason: string) => { this.closed = true; });
  send(body: string) { if (this.closed) throw new Error("closed"); this.frames.push(JSON.parse(body)); }
}
class Pair { 0 = new Socket(); 1 = new Socket(); }
class UpgradeResponse {
  status: number;
  headers: Headers;
  constructor(public body: string | null, init: ResponseInit = {}) { this.status = init.status ?? 200; this.headers = new Headers(init.headers); }
}
interface Room {
  publish(post: ChatPost): Promise<ChatPostResult>;
  fetch(request: Request): Promise<UpgradeResponse>;
  alarm(): Promise<void>;
  webSocketMessage(socket: Socket, message: string | ArrayBuffer): void;
  webSocketClose(socket: Socket, code: number, reason: string): void;
  webSocketError(socket: Socket): void;
  listBans(): Promise<ChatBan[]>;
  setBan(authorId: string, banned: boolean): Promise<ChatBanResult>;
}
const RoomClass = new Function("DurableObject", ...Object.keys(protocol), "closeWebSocket", "WebSocketPair", "Response", `${compiled};return ChatRoom;`)(
  class { constructor(public ctx: unknown, public env: unknown) {} }, ...Object.values(protocol), closeWebSocket, Pair, UpgradeResponse,
) as new (ctx: unknown, env: unknown) => Room;

const resources: DatabaseSync[] = [];
const author = (n = 1) => n.toString(16).padStart(64, "0");
const post = (n = 1, authorId = author(n)): ChatPost => ({ requestId: `request-${String(n).padStart(5, "0")}`, authorId, handle: "Quiet-Otter-1234", text: `Message ${n}` });

function setup(enabled: string | undefined = "true") {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const db = new DatabaseSync(":memory:"); resources.push(db);
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Chat must not make upstream requests"));
  let alarm: number | null = null;
  let failAlarm = false;
  let failReceipt = false;
  const sockets: Socket[] = [];
  const env: { CHAT_ENABLED?: string; CHAT_MUTED_AUTHORS?: string } = { CHAT_ENABLED: enabled };
  const alarms = {
    get: vi.fn(async () => alarm),
    set: vi.fn(async (at: number) => { if (failAlarm) { failAlarm = false; throw new Error("alarm failed"); } alarm = at; }),
    delete: vi.fn(async () => { alarm = null; }),
  };
  const ctx = {
    storage: {
      sql: { exec(sql: string, ...bindings: (string | number)[]) {
        if (failReceipt && sql.startsWith("INSERT INTO chat_receipts")) { failReceipt = false; throw new Error("receipt failed"); }
        if (sql.trimStart().startsWith("CREATE TABLE")) { db.exec(sql); return; }
        const rows = db.prepare(sql).all(...bindings);
        return { toArray: () => rows, one: () => { expect(rows).toHaveLength(1); return rows[0]; } };
      } },
      transactionSync<T>(action: () => T): T {
        db.exec("BEGIN");
        try { const result = action(); db.exec("COMMIT"); return result; }
        catch (error) { db.exec("ROLLBACK"); throw error; }
      },
      getAlarm: alarms.get,
      setAlarm: alarms.set,
      deleteAlarm: alarms.delete,
    },
    getWebSockets: () => sockets.filter((socket) => !socket.closed),
    acceptWebSocket: (socket: Socket) => { sockets.push(socket); },
  };
  let room = new RoomClass(ctx, env);
  return {
    db, env, sockets, network, alarms,
    get now() { return now; }, get alarm() { return alarm; },
    advance(ms: number) { now += ms; vi.advanceTimersByTime(ms); },
    hibernate() { room = new RoomClass(ctx, env); },
    publish: (input: ChatPost) => room.publish(input),
    async connect() { const response = await room.fetch(new Request("https://chat/ws/chat", { headers: { Upgrade: "websocket" } })); return { response, socket: sockets.at(-1)! }; },
    request: (request: Request) => room.fetch(request),
    write: (socket: Socket, input: string | ArrayBuffer) => room.webSocketMessage(socket, input),
    close: (socket: Socket) => room.webSocketClose(socket, 1000, "done"),
    error: (socket: Socket) => room.webSocketError(socket),
    listBans: () => room.listBans(),
    setBan: (authorId: string, banned: boolean) => room.setBan(authorId, banned),
    fire: () => { alarm = null; return room.alarm(); },
    failNextAlarm() { failAlarm = true; },
    failNextReceipt() { failReceipt = true; },
    count(table: "chat_messages" | "chat_receipts" | "chat_bans") { return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count; },
  };
}

afterEach(() => {
  for (const db of resources.splice(0)) db.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("shared read-only chat room", () => {
  it("starts with bounded history and follows it with trusted live messages", async () => {
    const s = setup();
    const joining = s.connect();
    const sending = s.publish(post());
    const { response, socket } = await joining;
    const result = await sending;
    expect(response.status).toBe(101); expect(result.ok).toBe(true);
    expect(socket.frames.map((frame) => frame.type)).toEqual(["history", "message"]);
    expect(socket.frames[0]).toEqual({ type: "history", messages: [], count: 1 });
    if (result.ok) expect(socket.frames[1]).toEqual({ type: "message", message: result.message, count: 1 });
    expect(s.network).not.toHaveBeenCalled();
  });

  it("does not accept HTTP writes or WebSocket publishing, including binary payloads", async () => {
    const s = setup(); const { socket } = await s.connect();
    expect((await s.request(new Request("https://chat/ws/chat", { method: "POST", body: JSON.stringify(post()) }))).status).toBe(405);
    expect((await s.request(new Request("https://chat/ws/chat"))).status).toBe(426);
    s.write(socket, JSON.stringify(post()));
    expect(socket.close).toHaveBeenCalledWith(1008, "read only");
    const other = await s.connect(); s.write(other.socket, new ArrayBuffer(10));
    expect(other.socket.closed).toBe(true); expect(s.count("chat_messages")).toBe(0);
  });

  it("fails closed when disabled and closes existing readers", async () => {
    const s = setup(); const { socket } = await s.connect();
    s.env.CHAT_ENABLED = "false";
    expect(await s.publish(post())).toEqual({ ok: false, error: "disabled" });
    expect(socket.close).toHaveBeenCalledWith(1008, "chat disabled");
    expect((await s.connect()).response.status).toBe(503);
    s.env.CHAT_ENABLED = undefined;
    expect(await s.publish(post())).toEqual({ ok: false, error: "disabled" });
    expect(s.count("chat_messages")).toBe(0);
  });

  it("honors opaque author mutes while keeping public reads available", async () => {
    const s = setup(); s.env.CHAT_MUTED_AUTHORS = ` ${author()},${author(5)}`;
    expect(await s.publish(post())).toEqual({ ok: false, error: "muted" });
    expect((await s.publish(post(2))).ok).toBe(true);
    expect((await s.connect()).response.status).toBe(101);
  });

  it("rejects raw-address identity and never emits unknown caller fields", async () => {
    const s = setup(); const rawAddress = "bc1qraw_wallet_address";
    expect(await s.publish({ ...post(), authorId: rawAddress })).toEqual({ ok: false, error: "invalid_message" });
    expect(await s.publish({ ...post(), text: "bad\u0000text" })).toEqual({ ok: false, error: "invalid_message" });
    const result = await s.publish({ ...post(), text: "  hello\r\nworld  ", address: rawAddress } as ChatPost);
    expect(result.ok).toBe(true);
    const { socket } = await s.connect();
    expect(JSON.stringify(socket.frames)).not.toContain(rawAddress);
    if (result.ok) expect(result.message.text).toBe("hello\nworld");
  });

  it("enforces the exact sender cooldown across sockets and hibernation", async () => {
    const s = setup(); expect((await s.publish(post())).ok).toBe(true);
    s.hibernate(); await s.connect();
    expect(await s.publish(post(2, author()))).toEqual({ ok: false, error: "rate_limited", retryAfter: 3 });
    s.advance(2999);
    expect(await s.publish(post(2, author()))).toEqual({ ok: false, error: "rate_limited", retryAfter: 1 });
    s.advance(1); expect((await s.publish(post(2, author()))).ok).toBe(true);
  });

  it("serializes simultaneous posts from one author", async () => {
    const s = setup(); const { socket } = await s.connect();
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => s.publish(post(n + 1, author()))));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error === "rate_limited")).toHaveLength(9);
    expect(s.count("chat_messages")).toBe(1); expect(s.count("chat_receipts")).toBe(1);
    expect(socket.frames.filter((frame) => frame.type === "message")).toHaveLength(1);
  });

  it("enforces one durable global window across concurrent authors", async () => {
    const s = setup();
    const results = await Promise.all(Array.from({ length: 25 }, (_, n) => s.publish(post(n + 1))));
    expect(results.filter((result) => result.ok)).toHaveLength(20);
    expect(results.filter((result) => !result.ok && result.error === "rate_limited" && result.retryAfter === 10)).toHaveLength(5);
    s.hibernate(); s.advance(9999);
    expect(await s.publish(post(100))).toEqual({ ok: false, error: "rate_limited", retryAfter: 1 });
    s.advance(1); expect((await s.publish(post(100))).ok).toBe(true);
  });

  it("restores history and idempotency after a room instance is discarded", async () => {
    const s = setup(); const first = await s.publish(post());
    expect(first.ok).toBe(true); s.hibernate();
    const { socket } = await s.connect();
    if (first.ok) expect(socket.frames).toEqual([{ type: "history", messages: [first.message], count: 1 }]);
    expect(await s.publish(post())).toEqual(first);
    expect(socket.frames).toHaveLength(1); expect(s.count("chat_messages")).toBe(1);
  });

  it("scopes request IDs to the author and rejects changed retries", async () => {
    const s = setup(); const original = await s.publish(post());
    expect(await s.publish({ ...post(), text: "different" })).toEqual({ ok: false, error: "invalid_message" });
    expect(await s.publish({ ...post(), handle: "Other-Handle" })).toEqual(original);
    expect((await s.publish({ ...post(), authorId: author(2) })).ok).toBe(true);
    expect(s.count("chat_messages")).toBe(2);
  });

  it("uses current compact handles for old stored history without changing author identity", async () => {
    const s = setup(); const result = await s.publish(post());
    s.db.prepare("UPDATE chat_messages SET handle = ?").run("Old-Long-Local-Handle");
    s.hibernate(); const { socket } = await s.connect();
    if (result.ok) expect(socket.frames).toEqual([{ type: "history", messages: [{ ...result.message, handle: protocol.chatHandle(author()) }], count: 1 }]);
    const receipt = s.db.prepare("SELECT digest FROM chat_receipts WHERE author_id = ?").get(author())!;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(post().text));
    expect(receipt.digest).toBe(Buffer.from(bytes).toString("hex"));
  });

  it("keeps only 50 ordered messages while retrying a capped message without extra stored text", async () => {
    const s = setup(); const first = await s.publish(post());
    for (let n = 2; n <= 51; n++) { s.advance(1000); expect((await s.publish(post(n))).ok).toBe(true); }
    s.hibernate(); const { socket } = await s.connect();
    const history = socket.frames[0]; expect(history.type).toBe("history");
    if (history.type === "history") {
      expect(history.messages).toHaveLength(50);
      expect(history.messages[0].text).toBe("Message 2"); expect(history.messages.at(-1)!.text).toBe("Message 51");
    }
    expect(await s.publish(post())).toEqual(first);
    expect(socket.frames).toHaveLength(1); expect(s.count("chat_messages")).toBe(50);
    const receipt = s.db.prepare("SELECT * FROM chat_receipts WHERE author_id = ?").get(author())!;
    expect(receipt).not.toHaveProperty("text"); expect(receipt).not.toHaveProperty("handle");
  });

  it("prunes on the 24-hour boundary, broadcasts expiry and retires its cleanup alarm", async () => {
    const s = setup(); await s.publish(post()); const firstExpiry = s.now + protocol.CHAT_TTL_MS;
    s.advance(4000); await s.publish(post(2));
    const { socket } = await s.connect(); expect(s.alarm).toBe(firstExpiry);
    s.advance(protocol.CHAT_TTL_MS - 4000); s.hibernate(); await s.fire();
    expect(s.count("chat_messages")).toBe(1); expect(s.count("chat_receipts")).toBe(1);
    expect(s.alarm).toBe(firstExpiry + 4000);
    expect(s.alarms.set.mock.calls).toEqual([[firstExpiry], [firstExpiry + 4000]]);
    expect(socket.frames.at(-1)?.type).toBe("history");
    s.advance(4000); await s.fire();
    expect(socket.frames.at(-1)).toEqual({ type: "history", messages: [], count: 1 });
    expect(s.count("chat_messages")).toBe(0); expect(s.count("chat_receipts")).toBe(0); expect(s.alarm).toBeNull();
    const frames = socket.frames.length; await s.fire(); expect(socket.frames).toHaveLength(frames);
    expect(s.alarms.delete).not.toHaveBeenCalled();
  });

  it("does not rewrite unchanged alarms for reads, cooldown refusals, retries, or hibernation", async () => {
    const s = setup(); await s.connect(); await s.connect(); await s.fire();
    expect(s.alarms.set).not.toHaveBeenCalled(); expect(s.alarms.delete).not.toHaveBeenCalled();
    const first = await s.publish(post()); const expiry = s.now + protocol.CHAT_TTL_MS;
    expect(s.alarms.set.mock.calls).toEqual([[expiry]]);
    await s.connect(); s.hibernate(); await s.connect();
    expect(await s.publish(post(2, author()))).toEqual({ ok: false, error: "rate_limited", retryAfter: 3 });
    expect(await s.publish(post())).toEqual(first);
    s.advance(3000); expect((await s.publish(post(2, author()))).ok).toBe(true);
    expect(s.alarms.set.mock.calls).toEqual([[expiry]]);
    expect(s.alarms.delete).not.toHaveBeenCalled();
  });

  it("keeps a newer post's alarm after a delayed read prunes the previously expired room", async () => {
    const s = setup(); await s.publish(post()); const expiredAlarm = s.alarm;
    s.advance(protocol.CHAT_TTL_MS + 1);
    let finishRead!: (value: number | null) => void;
    s.alarms.get.mockImplementationOnce(() => new Promise<number | null>((resolve) => { finishRead = resolve; }));
    const reading = s.connect();
    await vi.waitFor(() => expect(s.alarms.get).toHaveBeenCalledTimes(2));
    const publishing = s.publish(post(2));
    await vi.waitFor(() => expect(s.count("chat_messages")).toBe(1));
    expect(s.alarms.set).toHaveBeenCalledTimes(1);
    finishRead(expiredAlarm);
    expect((await reading).response.status).toBe(101); expect((await publishing).ok).toBe(true);
    expect(s.alarms.delete).toHaveBeenCalledTimes(1);
    expect(s.alarm).toBe(s.now + protocol.CHAT_TTL_MS);
    expect(s.alarms.set).toHaveBeenCalledTimes(2);
  });

  it("does not replay stale history when an alarm was delayed", async () => {
    const s = setup(); await s.publish(post()); s.advance(protocol.CHAT_TTL_MS + 1); s.hibernate();
    const { socket } = await s.connect(); expect(socket.frames).toEqual([{ type: "history", messages: [], count: 1 }]);
    expect(s.count("chat_receipts")).toBe(0); expect(s.alarm).toBeNull();
    expect(s.alarms.delete).toHaveBeenCalledTimes(1);
    await s.connect(); await s.connect();
    expect(s.alarms.delete).toHaveBeenCalledTimes(1);
  });

  it("caps receipt metadata and message history when new posts cross their limits", async () => {
    const s = setup();
    const base = s.now - 2048 * 3000 - 10_000;
    // Seed the retained boundary directly; two real publishes exercise both
    // caps without thousands of duplicate hashing/broadcast operations.
    s.db.prepare(`WITH RECURSIVE seed(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM seed WHERE n < 2048)
      INSERT INTO chat_receipts (author_id, request_id, message_id, created_at, digest)
      SELECT printf('%064x', n), printf('request-%05d', n), printf('seed-message-%05d', n), ? + n * 3000, printf('%064x', 0) FROM seed`).run(base);
    s.db.prepare(`WITH RECURSIVE seed(n) AS (VALUES(1999) UNION ALL SELECT n + 1 FROM seed WHERE n < 2048)
      INSERT INTO chat_messages (id, author_id, handle, text, created_at)
      SELECT printf('seed-message-%05d', n), printf('%064x', n), 'PepeAAAA', 'Message ' || n, ? + n * 3000 FROM seed`).run(base);
    for (const n of [2049, 2050]) { s.advance(3000); expect((await s.publish(post(n))).ok).toBe(true); }
    expect(s.count("chat_messages")).toBe(50); expect(s.count("chat_receipts")).toBe(2048);
    expect(s.db.prepare("SELECT request_id FROM chat_receipts ORDER BY created_at LIMIT 1").get()!.request_id).toBe(post(3).requestId);
    expect(s.db.prepare("SELECT text FROM chat_messages ORDER BY seq LIMIT 1").get()!.text).toBe("Message 2001");
    expect(s.db.prepare("SELECT text FROM chat_messages ORDER BY seq DESC LIMIT 1").get()!.text).toBe("Message 2050");
  });

  it("rolls back a failed receipt insert before any message is broadcast", async () => {
    const s = setup(); const { socket } = await s.connect(); s.failNextReceipt();
    await expect(s.publish(post())).rejects.toThrow("receipt failed");
    expect(s.count("chat_messages")).toBe(0); expect(s.count("chat_receipts")).toBe(0); expect(socket.frames).toHaveLength(1);
    expect((await s.publish(post())).ok).toBe(true);
  });

  it("deduplicates a retry after a post committed but alarm scheduling failed", async () => {
    const s = setup(); const { socket } = await s.connect(); s.failNextAlarm();
    await expect(s.publish(post())).rejects.toThrow("alarm failed");
    const sent = socket.frames.at(-1); expect(sent?.type).toBe("message");
    const retry = await s.publish(post());
    if (sent?.type === "message") expect(retry).toEqual({ ok: true, message: sent.message });
    expect(socket.frames).toHaveLength(2); expect(s.count("chat_messages")).toBe(1); expect(s.alarm).not.toBeNull();
  });

  it("caps attached readers before accepting another socket", async () => {
    const s = setup();
    s.sockets.push(...Array.from({ length: 500 }, () => new Socket()));
    expect((await s.connect()).response.status).toBe(503); expect(s.sockets).toHaveLength(500);
    s.sockets[0].close(1000, "done"); expect((await s.connect()).response.status).toBe(101);
  });

  it("persists bans across hibernation, blocks retries, and preserves existing messages", async () => {
    const s = setup(); const original = await s.publish(post());
    const ban = { authorId: author(), handle: protocol.chatHandle(author()), createdAt: s.now };
    expect(await s.setBan(author(), true)).toEqual({ ok: true, authorId: author(), banned: true, ban });
    s.hibernate();
    expect(await s.listBans()).toEqual([ban]);
    expect(await s.publish(post())).toEqual({ ok: false, error: "banned" });
    s.advance(3000); expect(await s.publish(post(2, author()))).toEqual({ ok: false, error: "banned" });
    const { socket } = await s.connect();
    if (original.ok) expect(socket.frames[0]).toEqual({ type: "history", messages: [original.message], count: 1 });
    expect(s.count("chat_receipts")).toBe(1);
    expect(await s.setBan(author(), false)).toEqual({ ok: true, authorId: author(), banned: false, ban: null });
    expect(await s.publish(post())).toEqual(original);
    expect((await s.publish(post(2, author()))).ok).toBe(true);
    expect(await s.listBans()).toEqual([]);
  });

  it("does not rewrite repeated bans/unbans or create cleanup alarms for moderation", async () => {
    const s = setup();
    const changes = () => s.db.prepare("SELECT total_changes() AS count").get()!.count;
    const initial = changes();
    await s.setBan(author(), false); await s.listBans(); expect(changes()).toBe(initial);
    const first = await s.setBan(author(), true); const inserted = changes();
    s.advance(3000); expect(await s.setBan(author(), true)).toEqual(first);
    expect(changes()).toBe(inserted);
    await s.setBan(author(), false); const removed = changes();
    await s.setBan(author(), false); expect(changes()).toBe(removed);
    expect(s.alarms.get).not.toHaveBeenCalled(); expect(s.alarms.set).not.toHaveBeenCalled(); expect(s.alarms.delete).not.toHaveBeenCalled();
  });

  it("rejects invalid ban targets and keeps public socket frames read-only", async () => {
    const s = setup();
    for (const id of ["bc1qraw_wallet_address", "PepeAAAA", "A".repeat(64), "a".repeat(65), ""]) {
      expect(await s.setBan(id, true)).toEqual({ ok: false, error: "invalid_author" });
    }
    expect(await s.setBan(author(), "yes" as unknown as boolean)).toEqual({ ok: false, error: "invalid_author" });
    const { socket } = await s.connect();
    s.write(socket, JSON.stringify({ type: "ban", authorId: author(), banned: true }));
    expect(socket.close).toHaveBeenCalledWith(1008, "read only");
    expect(s.count("chat_bans")).toBe(0);
  });

  it("caps persistent bans without evicting prior decisions and allows unban at capacity", async () => {
    const s = setup();
    s.db.prepare(`WITH RECURSIVE seed(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM seed WHERE n < 499)
      INSERT INTO chat_bans (author_id, created_at) SELECT printf('%064x', n), ? FROM seed`).run(s.now);
    const results = await Promise.all([s.setBan(author(500), true), s.setBan(author(501), true)]);
    expect(results[0].ok).toBe(true); expect(results[1]).toEqual({ ok: false, error: "ban_limit" });
    expect(s.count("chat_bans")).toBe(protocol.CHAT_MAX_BANS);
    expect((await s.setBan(author(), true)).ok).toBe(true);
    expect((await s.setBan(author(), false)).ok).toBe(true);
    expect((await s.setBan(author(501), true)).ok).toBe(true);
    expect(await s.listBans()).toHaveLength(protocol.CHAT_MAX_BANS);
  });

  it("retains bans through history expiry and permits moderation while chat is disabled", async () => {
    const s = setup(); await s.setBan(author(), true);
    s.advance(protocol.CHAT_TTL_MS + 1); s.hibernate(); await s.fire();
    expect(s.count("chat_bans")).toBe(1);
    s.env.CHAT_ENABLED = "false";
    expect(await s.listBans()).toHaveLength(1);
    expect((await s.setBan(author(), false)).ok).toBe(true);
    expect((await s.setBan(author(2), true)).ok).toBe(true);
    expect(s.alarm).toBeNull();
  });

  it("enforces a ban applied while a publish is awaiting its text digest", async () => {
    const s = setup();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let finishDigest!: (value: ArrayBuffer) => void;
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(() => new Promise<ArrayBuffer>((resolve) => { finishDigest = resolve; }));
    const publishing = s.publish(post());
    await s.setBan(author(), true);
    finishDigest(await digest("SHA-256", new TextEncoder().encode(post().text)));
    expect(await publishing).toEqual({ ok: false, error: "banned" });
    expect(s.count("chat_messages")).toBe(0); expect(s.count("chat_receipts")).toBe(0);
  });

  it("sends exact join snapshots and coalesces join/leave count bursts into a trailing flush", async () => {
    const s = setup(); const a = (await s.connect()).socket;
    const b = (await s.connect()).socket; const c = (await s.connect()).socket;
    expect(a.frames[0]).toEqual({ type: "history", messages: [], count: 1 });
    expect(b.frames[0]).toEqual({ type: "history", messages: [], count: 2 });
    expect(c.frames[0]).toEqual({ type: "history", messages: [], count: 3 });
    expect(a.frames).toHaveLength(1); expect(vi.getTimerCount()).toBe(1);
    s.advance(4999); expect(a.frames).toHaveLength(1);
    s.advance(1); expect(a.frames.at(-1)).toEqual({ type: "presence", count: 3 });
    expect(vi.getTimerCount()).toBe(0);
    s.close(c); s.error(b);
    expect(vi.getTimerCount()).toBe(1);
    s.advance(5000); expect(a.frames.at(-1)).toEqual({ type: "presence", count: 1 });
    expect(vi.getTimerCount()).toBe(0);
    expect(s.alarms.set).not.toHaveBeenCalled(); expect(s.alarms.delete).not.toHaveBeenCalled();
  });

  it("cancels pending count timers when a message carries the count or the room empties", async () => {
    const s = setup(); const a = (await s.connect()).socket; const b = (await s.connect()).socket;
    expect(vi.getTimerCount()).toBe(1);
    await s.publish(post());
    expect(a.frames.at(-1)).toMatchObject({ type: "message", count: 2 });
    expect(vi.getTimerCount()).toBe(0);
    s.close(b); expect(vi.getTimerCount()).toBe(1);
    s.close(a); expect(vi.getTimerCount()).toBe(0);
    s.advance(5000); expect(vi.getTimerCount()).toBe(0);
  });

  it("restores the count from hibernating sockets without presence storage", async () => {
    const s = setup(); const a = (await s.connect()).socket; await s.connect();
    s.advance(5000); s.hibernate(); const c = (await s.connect()).socket;
    expect(c.frames[0]).toEqual({ type: "history", messages: [], count: 3 });
    expect(a.frames.at(-1)).toEqual({ type: "presence", count: 3 });
    expect(s.db.prepare("SELECT total_changes() AS count").get()!.count).toBe(0);
    expect(s.alarms.set).not.toHaveBeenCalled(); expect(s.alarms.delete).not.toHaveBeenCalled();
  });
});
