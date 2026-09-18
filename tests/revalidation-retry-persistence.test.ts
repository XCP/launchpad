import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { FatalError, IgnorableError, RecoverableError, isOpenNextError } from "@opennextjs/aws/utils/error.js";
import type { DOQueueHandler as QueueType } from "@opennextjs/cloudflare/durable-objects/queue";
import type { QueueMessage } from "@opennextjs/aws/types/overrides.js";

// Run the installed adapter, replacing only the platform base class and logger.
const upstream = readFileSync(new URL("../node_modules/@opennextjs/cloudflare/dist/api/durable-objects/queue.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?$/gm, "")
  .replace("export class DOQueueHandler", "class DOQueueHandler");
const Original = new Function("DurableObject", "FatalError", "IgnorableError", "RecoverableError", "isOpenNextError", "debug", "warn", "error", `${upstream};return DOQueueHandler;`)(
  class { constructor(public ctx: unknown, public env: unknown) {} },
  FatalError, IgnorableError, RecoverableError, isOpenNextError, () => {}, () => {}, () => {},
) as typeof QueueType;
const custom = readFileSync(new URL("../apps/web/worker.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\r?$/gm, "")
  .replace(/^export (?:default handler|\{.*\});\r?$/gm, "")
  .replace("export class DOQueueHandler", "class DOQueueHandler");
const Fixed = new Function("OpenNextQueue", `${custom};return DOQueueHandler;`)(Original) as typeof QueueType;

const message: QueueMessage = {
  MessageDeduplicationId: "home-v1", MessageGroupId: "home",
  MessageBody: { host: "xcp.fun", url: "/en", lastModified: 1_000, eTag: "old" },
};

function fixture(Queue: typeof QueueType, disableSQLite = false) {
  const db = new DatabaseSync(":memory:");
  let initialization: Promise<unknown> = Promise.resolve();
  let alarm: number | null = null;
  const fetch = vi.fn(async () => new Response(null, { status: 500 }));
  const sql = { exec(query: string, ...args: unknown[]) {
    const rows = db.prepare(query).all(...args as []);
    return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } };
  const ctx = {
    storage: { sql, getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } },
    blockConcurrencyWhile(fn: () => Promise<unknown>) { initialization = fn(); return initialization; },
    waitUntil() {},
  };
  process.env.__OPEN_NEXT_BUILD_ID = "retry-persistence-test";
  const env = { WORKER_SELF_REFERENCE: { fetch }, NEXT_CACHE_DO_QUEUE_DISABLE_SQLITE: String(disableSQLite) };
  let queue: QueueType;
  return {
    db, fetch,
    async restart() {
      alarm = null;
      queue = new Queue(ctx as unknown as DurableObjectState, env as unknown as CloudflareEnv);
      await initialization;
      return queue;
    },
    async alarm() { alarm = null; await queue.alarm(); },
    count: () => Number(db.prepare("SELECT COUNT(*) n FROM failed_state").get()!.n),
  };
}

describe("page refresh retry persistence", () => {
  it("reproduces repeated rendering after restart and removes it with the custom queue", async () => {
    const counts = [];
    for (const Queue of [Original, Fixed]) {
      const f = fixture(Queue);
      try {
        const queue = await f.restart();
        await queue.executeRevalidation(message);
        expect(f.count()).toBe(1);
        f.fetch.mockImplementation(async () => new Response(null, { headers: { "x-nextjs-cache": "REVALIDATED" } }));
        await f.alarm();
        const completedCalls = f.fetch.mock.calls.length;
        for (let n = 0; n < 5; n++) { await f.restart(); await f.alarm(); }
        counts.push(f.fetch.mock.calls.length - completedCalls);
        expect(f.count()).toBe(Queue === Original ? 1 : 0);
      } finally { f.db.close(); }
    }
    expect(counts).toEqual([5, 0]);
  });

  it("keeps genuine failures durable and preserves retry limits", async () => {
    const f = fixture(Fixed);
    try {
      const queue = await f.restart();
      await queue.executeRevalidation(message);
      expect(f.count()).toBe(1);
      const restored = await f.restart();
      expect(restored.routeInFailedState.has(message.MessageDeduplicationId)).toBe(true);
      for (let n = 0; n < restored.maxRetries; n++) await f.alarm();
      expect(f.fetch).toHaveBeenCalledTimes(1 + restored.maxRetries);
      expect(f.count()).toBe(0);
      await f.restart(); await f.alarm();
      expect(f.fetch).toHaveBeenCalledTimes(1 + restored.maxRetries);
    } finally { f.db.close(); }
  });

  it.each([404, 200])("retires a formerly failed route on terminal status %i", async (status) => {
    const f = fixture(Fixed);
    try {
      const queue = await f.restart();
      await queue.executeRevalidation(message);
      f.fetch.mockImplementation(async () => new Response(null, { status }));
      await f.alarm();
      expect(f.count()).toBe(0);
    } finally { f.db.close(); }
  });

  it("allows a later stale version to refresh after the earlier retry succeeds", async () => {
    const f = fixture(Fixed);
    try {
      const queue = await f.restart();
      await queue.executeRevalidation(message);
      f.fetch.mockImplementation(async () => new Response(null, { headers: { "x-nextjs-cache": "REVALIDATED" } }));
      await f.alarm();
      await queue.executeRevalidation({ ...message, MessageDeduplicationId: "home-v2", MessageBody: { ...message.MessageBody, eTag: "new" } });
      expect(f.fetch).toHaveBeenCalledTimes(3);
      expect(f.count()).toBe(0);
    } finally { f.db.close(); }
  });

  it("retains the adapter's in-memory-only mode", async () => {
    const f = fixture(Fixed, true);
    try {
      const queue = await f.restart();
      await queue.executeRevalidation(message);
      f.fetch.mockImplementation(async () => new Response(null, { headers: { "x-nextjs-cache": "REVALIDATED" } }));
      await f.alarm();
      expect(queue.routeInFailedState.size).toBe(0);
    } finally { f.db.close(); }
  });
});
