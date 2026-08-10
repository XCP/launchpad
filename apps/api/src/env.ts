import type { LaunchRoom } from "#api/durable/launch-room";
import type { SitePresence } from "#api/durable/site-presence";

export interface Env {
  DB: D1Database;
  LAUNCH_ROOM: DurableObjectNamespace<LaunchRoom>;
  SITE_PRESENCE: DurableObjectNamespace<SitePresence>;
}
