import type { Announcer } from "#api/durable/announcer";
import type { LaunchRoom } from "#api/durable/launch-room";
import type { SitePresence } from "#api/durable/site-presence";

export interface Env {
  DB: D1Database;
  /** Creator JSON shared with the web worker. The indexer reads this directly
   *  rather than asking Cloudflare to route an HTTP request back to itself. */
  METADATA: R2Bucket;
  LAUNCH_ROOM: DurableObjectNamespace<LaunchRoom>;
  SITE_PRESENCE: DurableObjectNamespace<SitePresence>;
  /** One instance, site-wide — the rate limit being managed belongs to the
   *  channel, so several queues would just race into the same ceiling. */
  ANNOUNCER: DurableObjectNamespace<Announcer>;
  /** Bot token for the announce channel. A secret — `wrangler secret put`,
   *  never wrangler.toml. Absent in dev, which switches announcing off rather
   *  than failing: a local tick should not post to the real channel. */
  TELEGRAM_BOT_TOKEN?: string;
  /** The channel to post in. Not a secret — a public channel's id is public —
   *  so it lives in [vars] where it can be read and changed in the open. */
  TELEGRAM_CHAT_ID?: string;
  /** Guards the admin routes that replay history into the channel. Secret. */
  ADMIN_TOKEN?: string;
}
