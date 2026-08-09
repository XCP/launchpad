import { Hono } from "hono";
import type { Env } from "#api/env";
import { syncLaunches } from "#api/indexer/sync";
import { launchesRoute } from "#api/read/launches";
import { runScheduledJob } from "#api/scheduler/job";
import { withLock } from "#api/scheduler/lock";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("launchpad-api ok"));
app.get("/health", (c) => c.text("ok"));
app.route("/", launchesRoute);

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      withLock(env.DB, 110, () => runScheduledJob("sync_launches", () => syncLaunches(env.DB))),
    );
  },
} satisfies ExportedHandler<Env>;
