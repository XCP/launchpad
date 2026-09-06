import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";

// Exercise the actual DO class with a deterministic clock/storage/sockets.
// Node cannot import cloudflare:workers; remove only imports and provide its
// base class. poll() is the upstream boundary, not the scheduling under test.
const source = readFileSync(
  new URL("../apps/api/src/durable/launch-room.ts", import.meta.url), "utf8",
).replace(/^import .*;\r?$/gm, "").replace("export class LaunchRoom", "class LaunchRoom");
const compiled = transformSync(source, { loader: "ts", target: "es2022" }).code;

interface State {
  status: string;
  earned_quantity: string;
  paid_quantity: string;
  pending_count: number;
  pending_quantity: string;
  pending: [];
}
interface Room {
  alarm(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  webSocketMessage(socket: unknown, message: string): Promise<void>;
  poll(txHash: string): Promise<State>;
}
const RoomClass = new Function("DurableObject", `${compiled};return LaunchRoom;`)(
  class { constructor(public ctx: unknown, public env: unknown) {} },
) as new (ctx: unknown, env: unknown) => Room;

const snapshot = (pending = 1, earned = "0"): State => ({
  status: pending ? "open" : "closed", earned_quantity: earned,
  paid_quantity: "0", pending_count: pending, pending_quantity: String(pending), pending: [],
});

function setup(initial = snapshot()) {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const data = new Map<string, unknown>([["txHash", "test"], ["asset", "COIN"]]);
  let alarm: number | null = null;
  let viewers = 1;
  const sent: string[] = [];
  const put = vi.fn(async (key: string, value: unknown) => { data.set(key, structuredClone(value)); });
  const setAlarm = vi.fn(async (at: number) => { alarm = at; });
  const ctx = {
    storage: { get: async (key: string) => structuredClone(data.get(key)), put, getAlarm: async () => alarm, setAlarm },
    getWebSockets: () => Array.from({ length: viewers }, () => ({ send: (body: string) => sent.push(body) })),
    acceptWebSocket: () => undefined,
  };
  const poll = vi.fn(async () => structuredClone(initial));
  let room = new RoomClass(ctx, {});
  room.poll = poll;
  return {
    poll, sent, put, setAlarm, data,
    get now() { return now; },
    get alarm() { return alarm; },
    advance(ms: number) { now += ms; },
    viewers(n: number) { viewers = n; },
    hibernate() { room = new RoomClass(ctx, {}); room.poll = poll; },
    ping: () => room.webSocketMessage({}, "p"),
    nudge: () => room.fetch(new Request("https://room/COIN?nudge=1")),
    connect: () => room.fetch(new Request("https://room/COIN?fm=test", { headers: { Upgrade: "websocket" } })),
    async fire() {
      expect(alarm).not.toBeNull();
      now = Math.max(now, alarm!);
      alarm = null;
      await room.alarm();
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("shared launch room polling", () => {
  it("keeps pending confirmations on a 15-second cadence through a long unchanged queue and hibernation", async () => {
    const s = setup();
    await s.nudge();
    await s.fire();
    for (let tick = 1; tick <= 80; tick++) {
      if (tick % 4 === 0) { s.hibernate(); await s.nudge(); }
      await s.fire();
      expect(s.alarm).toBe(s.now + 15_000);
    }
    expect(s.poll).toHaveBeenCalledTimes(81);
    expect(s.sent).toHaveLength(1);
    s.hibernate();
    await s.nudge();
    expect(s.alarm).toBe(s.now + 15_000);
    await s.ping();
    expect(s.alarm).toBe(s.now + 15_000);
    await s.fire();
    expect(s.alarm).toBe(s.now + 15_000);
    expect(s.put.mock.calls.filter(([key]) => key === "last")).toHaveLength(1);
    const beforeConfirmation = s.now;
    s.advance(1_000);
    s.poll.mockResolvedValue(snapshot(0, "100"));
    await s.fire();
    expect(s.now - beforeConfirmation).toBe(15_000);
    expect(JSON.parse(s.sent.at(-1)!).pending_count).toBe(0);
    expect(s.alarm).toBeNull();
  });

  it("broadcasts a changed pending queue on its next 15-second poll", async () => {
    const s = setup();
    await s.nudge();
    for (let tick = 0; tick <= 20; tick++) await s.fire();
    s.poll.mockResolvedValue(snapshot(2, "10"));
    await s.nudge();
    await s.fire();
    expect(s.alarm).toBe(s.now + 15_000);
    expect(s.sent).toHaveLength(2);
  });

  it("coalesces staggered viewers into one 30-second refresh after eviction", async () => {
    const s = setup(snapshot(0));
    await s.ping();
    await s.fire();
    const first = s.now;
    s.hibernate();
    for (let viewer = 0; viewer < 20; viewer++) {
      s.advance(1_000);
      await s.ping();
      expect(s.alarm).toBe(first + 30_000);
    }
    expect(s.poll).toHaveBeenCalledTimes(1);
    await s.fire();
    expect(s.poll).toHaveBeenCalledTimes(2);
    expect(s.sent).toHaveLength(1);
    expect(s.put.mock.calls.filter(([key]) => key === "last")).toHaveLength(1);
  });

  it("does not create another poll while an upstream request is in flight", async () => {
    const s = setup(snapshot(0));
    let resolve!: (state: State) => void;
    s.poll.mockImplementationOnce(() => new Promise<State>((done) => { resolve = done; }));
    await s.ping();
    const firing = s.fire();
    await vi.waitFor(() => expect(s.poll).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 20; i++) await s.ping();
    expect(s.alarm).toBeNull();
    resolve(snapshot(0));
    await firing;
    expect(s.sent).toHaveLength(1);
  });

  it("stops polling when the queue drains and broadcasts its confirmation", async () => {
    const s = setup();
    await s.ping();
    await s.fire();
    s.poll.mockResolvedValue(snapshot(0, "100"));
    await s.fire();
    expect(s.alarm).toBeNull();
    expect(JSON.parse(s.sent.at(-1)!).earned_quantity).toBe("100");
  });

  it("does no upstream work after the last viewer leaves", async () => {
    const s = setup();
    await s.ping();
    s.viewers(0);
    await s.fire();
    expect(s.poll).not.toHaveBeenCalled();
    expect((await s.nudge()).status).toBe(204);
    expect(s.alarm).toBeNull();
  });

  it("immediately replays stored state to a reconnect without defeating cooldown", async () => {
    const s = setup(snapshot(0, "100"));
    await s.ping();
    await s.fire();
    s.hibernate();
    const replay: string[] = [];
    vi.stubGlobal("WebSocketPair", class {
      0 = {};
      1 = { send: (body: string) => replay.push(body) };
    });
    // Node's Response rejects 101; the Worker runtime accepts the upgrade.
    vi.stubGlobal("Response", class {
      status: number;
      constructor(_body: unknown, init: { status: number }) { this.status = init.status; }
    });
    expect((await s.connect()).status).toBe(101);
    expect(JSON.parse(replay[0]!).earned_quantity).toBe("100");
    expect(s.poll).toHaveBeenCalledTimes(1);
    expect(s.alarm).toBe(s.now + 30_000);
  });
});
