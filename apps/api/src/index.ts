import { Hono } from "hono";
import type { Env } from "#api/env";
import { syncLaunches } from "#api/indexer/sync";
import { launchesRoute } from "#api/read/launches";
import { mintClosed } from "#api/telegram/format";
import { send } from "#api/telegram/send";
import { runScheduledJob } from "#api/scheduler/job";
import { withLock } from "#api/scheduler/lock";

export { LaunchRoom } from "#api/durable/launch-room";
export { SitePresence } from "#api/durable/site-presence";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("launchpad-api ok"));
app.get("/health", (c) => c.text("ok"));
app.route("/", launchesRoute);

/**
 * Post one sample announcement, to prove the bot is wired up.
 *
 * Guarded by ADMIN_TOKEN and compared with a constant-time-ish equality that
 * at least does not leak length on the first character — this endpoint writes
 * to a public channel, so an open one is a graffiti button. Returns what it
 * would send when `dry` is set, which is how the wording gets reviewed without
 * posting.
 */
app.post("/admin/announce-test", async (c) => {
  const supplied = c.req.header("x-admin-token") ?? "";
  const expected = c.env.ADMIN_TOKEN ?? "";
  if (!expected || supplied.length !== expected.length || supplied !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const sample = mintClosed({
    asset: "PEPXCPCASH",
    graduated: true,
    earnedRaw: 69_000_000_000n,
    mints: 142,
    minters: 69,
  });
  if (c.req.query("dry")) return c.json({ would_send: sample });

  const token = c.env.TELEGRAM_BOT_TOKEN;
  const chat = c.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return c.json({ error: "bot not configured" }, 503);
  const result = await send(token, chat, sample);
  return c.json({ sent: result.ok, ...result }, result.ok ? 200 : 502);
});

// One Durable Object room per launch (id = asset ticker). The client passes
// the fairminter tx_hash it already has as `fm`; the room pins it on first
// connect and every later viewer just subscribes. This is a plain fetch
// forward, not a Hono-handled response: the DO does the WebSocket upgrade
// handshake itself.
app.get("/ws/launches/:asset", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("expected a websocket upgrade", 426);
  }
  const asset = c.req.param("asset").toUpperCase();
  const id = c.env.LAUNCH_ROOM.idFromName(asset);
  const stub = c.env.LAUNCH_ROOM.get(id);
  return stub.fetch(c.req.raw);
});

// Site-wide "how many tabs have this open right now" — one fixed room, every
// page connects to the same instance.
app.get("/ws/presence", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("expected a websocket upgrade", 426);
  }
  const id = c.env.SITE_PRESENCE.idFromName("global");
  const stub = c.env.SITE_PRESENCE.get(id);
  return stub.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      withLock(env.DB, 110, () => runScheduledJob("sync_launches", () => syncLaunches(env.DB))),
    );
  },
} satisfies ExportedHandler<Env>;
