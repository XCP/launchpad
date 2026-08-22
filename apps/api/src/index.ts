import { Hono } from "hono";
import type { Env } from "#api/env";
import { syncLaunches } from "#api/indexer/sync";
import { launchesRoute } from "#api/read/launches";
import { mintClosed } from "#api/telegram/format";
import { announceLive, queueAnnouncements } from "#api/telegram/live";
import { buildBacklog } from "#api/telegram/replay";
import { send } from "#api/telegram/send";
import { fetchBlockHeight, fetchMempoolFairmints } from "#api/integrations/counterparty";

export { Announcer } from "#api/durable/announcer";

/** Length-then-value, so a wrong token does not leak its length by failing
 *  faster on a short one. Not constant time, but this guards a channel post,
 *  not a key. */
function authed(supplied: string | undefined, expected: string | undefined): boolean {
  const a = supplied ?? "";
  const b = expected ?? "";
  return b.length > 0 && a.length === b.length && a === b;
}
import { runScheduledJob } from "#api/scheduler/job";
import { withLock } from "#api/scheduler/lock";
import { claimFastSync, recordMempoolSnapshot } from "#api/scheduler/mempool-transition";

export { LaunchRoom } from "#api/durable/launch-room";
export { SitePresence } from "#api/durable/site-presence";

const app = new Hono<{ Bindings: Env }>();

/**
 * Let the browser report timing for our own responses.
 *
 * Resource Timing zeroes `requestStart` and `responseStart` for cross-origin
 * responses unless the server opts in, and the site is served from a different
 * host than the API answers from -- so every call measured in a real browser
 * collapses to one opaque `duration`. That makes "queued behind the JS
 * download" and "the worker was slow" indistinguishable, which are opposite
 * problems with opposite fixes.
 *
 * Only timing is exposed, never headers or bodies, and these routes are public
 * and unauthenticated.
 */
app.use("*", async (c, next) => {
  await next();

  // A 101 is a WebSocket handshake that a Durable Object performed itself and
  // handed back through stub.fetch(), and a Response that arrived from a
  // subrequest carries immutable headers. Setting one throws, and the throw
  // takes the upgrade with it -- /ws/presence and /ws/launches/:asset have
  // both been answering 500 since this middleware was added, which is the site
  // presence badge and every live launch room. Resource Timing does not
  // describe websockets anyway, so there was never a header to add here.
  if (c.res.status === 101) return;

  // Any other response that did not originate in this Worker is immutable for
  // the same reason. Rebuilding is cheap -- the body passes through as a
  // stream -- and it means one measurement header can never again be the thing
  // that decides whether a route works.
  try {
    c.res.headers.set("Timing-Allow-Origin", "*");
  } catch {
    const rebuilt = new Response(c.res.body, c.res);
    rebuilt.headers.set("Timing-Allow-Origin", "*");
    c.res = rebuilt;
  }
});

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
/**
 * Replay the whole backlog into the channel, oldest first.
 *
 * `?dry=1` returns every message it would send, in order, without sending or
 * claiming anything — which is how a couple of hundred messages get reviewed
 * before any of them are read by a person.
 *
 * The Durable Object accepts each chain-derived key once, then D1 records that
 * acceptance. Running this twice is harmless, including after a failure
 * between those systems: the queue returns the first acceptance instead of
 * appending a duplicate, and D1 repairs its acknowledgement.
 */
app.post("/admin/replay", async (c) => {
  if (!authed(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const height = await fetchBlockHeight();
  const backlog = await buildBacklog(c.env.DB, height);

  if (c.req.query("dry")) {
    return c.json({
      count: backlog.length,
      estimated_minutes: Math.ceil((backlog.length * 3.5) / 60),
      items: backlog.map((b) => ({ key: b.key, block: b.block, text: b.a.text })),
    });
  }

  const result = await queueAnnouncements(
    c.env,
    backlog.map((item) => ({
      key: item.key,
      a: item.a,
      // Never collapsed. A replay is the feed it would have been, and it would
      // not have been a digest — these arrived days apart.
      mintOf: null,
      earned: item.mint?.earned ?? "0",
      paid: item.mint?.paid ?? "0",
    })),
  );
  return c.json({
    queued: result.newlyQueued,
    accepted: result.accepted,
    skipped: backlog.length - result.accepted,
    depth: result.depth,
  });
});

/**
 * Turn the live feed on or off.
 *
 * Off by default, and it matters that it is: with the past unclaimed the first
 * tick would announce the entire backlog itself — out of order, without the
 * replay's pacing, and into whatever the channel already had. The order is
 * replay, then this.
 *
 * Also the off switch. If the feed starts saying something wrong at three in
 * the morning, one call stops it without a deploy, and the announced table
 * keeps its place so nothing is repeated when it comes back.
 */
app.post("/admin/live", async (c) => {
  if (!authed(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const on = c.req.query("off") ? "0" : "1";
  await c.env.DB.prepare(
    `INSERT INTO announce_state (key, value) VALUES ('live', ?1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE announce_state.value IS NOT excluded.value`,
  )
    .bind(on)
    .run();
  return c.json({ live: on === "1" });
});

/** Queue depth and a way to abandon a replay that was a mistake. */
app.post("/admin/queue", async (c) => {
  if (!authed(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const stub = c.env.ANNOUNCER.get(c.env.ANNOUNCER.idFromName("global"));
  if (c.req.query("drain")) return c.json({ dropped: await stub.drain() });
  return c.json({ depth: await stub.depth() });
});

app.post("/admin/announce-test", async (c) => {
  if (!authed(c.req.header("x-admin-token"), c.env.ADMIN_TOKEN)) {
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
  async scheduled(event, env, ctx) {
    /**
     * The one-minute sweep: wake the rooms that have something to say.
     *
     * Launch rooms stop scheduling their own alarm once a launch's mempool
     * queue empties, because a pending alarm blocks hibernation and bills a
     * full day of duration for a room that is doing nothing. That trade needs
     * exactly one thing in return — a way for a sleeping room to find out its
     * launch got busy again while its viewers were sitting there.
     *
     * One mempool read for the whole site, then a nudge to the handful of
     * rooms that appear in it. Nothing pending means one fetch and no DO
     * requests at all, which is the normal case. A room nobody is watching
     * answers 204 and goes straight back to sleep without polling.
     */
    if (event.cron === "* * * * *") {
      ctx.waitUntil(
        runScheduledJob("wake_rooms", async () => {
          const pending = await fetchMempoolFairmints();
          const assets = [...new Set(pending.map((m) => m.asset))];
          await Promise.all(
            assets.map(async (asset) => {
              const stub = env.LAUNCH_ROOM.get(env.LAUNCH_ROOM.idFromName(asset));
              // Absolute URL because a DO stub requires one; the host is
              // never resolved, only the query is read.
              await stub.fetch(`https://launch-room/${asset}?nudge=1`);
            }),
          );
          const transition = await recordMempoolSnapshot(
            env.DB,
            pending.map((m) => m.txHash),
          );

          // A transaction leaving the mempool is normally a confirmation.
          // Reuse the proven, delta-guarded reconciliation immediately rather
          // than building a second partial indexer. The ordinary five-minute
          // run remains the repair pass if this signal or this lock is missed.
          const fastSyncClaimed =
            transition.disappeared > 0 && (await claimFastSync(env.DB));
          let fastSyncRan = false;
          if (fastSyncClaimed) {
            fastSyncRan = await withLock(env.DB, 110, async () => {
              await runScheduledJob("sync_after_mempool", () =>
                syncLaunches(env.DB, env.METADATA),
              );
              await runScheduledJob("announce_after_mempool", async () => {
                const height = await fetchBlockHeight();
                return announceLive(env, height);
              });
            });
          }

          return {
            rooms_nudged: assets.length,
            pending_mints: transition.pending,
            disappeared: transition.disappeared,
            fast_sync_claimed: fastSyncClaimed,
            fast_sync_ran: fastSyncRan,
          };
        }).then(() => undefined),
      );
      return;
    }

    ctx.waitUntil(
      withLock(env.DB, 110, async () => {
        await runScheduledJob("sync_launches", () => syncLaunches(env.DB, env.METADATA));
        // After the indexer, never inside it. The feed reads committed state
        // rather than the tick's own deltas, so an announcement can only
        // describe something D1 already believes — and a tick that dies
        // half-done leaves nothing announced that did not happen.
        //
        // Inside the same lock so the index and feed normally advance as one
        // ordered pass. The Durable Object's accepted-key markers still make
        // an overlapping admin replay or retry harmless.
        await runScheduledJob("announce", async () => {
          const height = await fetchBlockHeight();
          return announceLive(env, height);
        });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
