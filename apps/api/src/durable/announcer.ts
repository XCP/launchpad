import { DurableObject } from "cloudflare:workers";
import type { Env } from "#api/env";
import { nextAnnouncement, type Queued } from "#api/telegram/digest";
import { send } from "#api/telegram/send";

/**
 * The channel's one mouth.
 *
 * Telegram allows roughly twenty messages a minute to a single chat and 429s
 * past that, which is squarely in the way of a feed whose whole point is being
 * chatty. A cron tick that finds forty mints cannot simply send forty
 * messages; without pacing the excess is not delayed, it is lost, and lost
 * silently.
 *
 * So the indexer never sends. It hands events here and returns. This object
 * holds the backlog in durable storage and drains it on an alarm at a rate
 * Telegram accepts, which also makes it the only place that has to know
 * anything about rate limits, retries, or what to do when the feed falls
 * behind the chain.
 *
 * One instance, site-wide — the constraint being managed belongs to the
 * channel, not to any launch, so a per-launch room would just be several
 * queues racing each other into the same limit.
 */

/** ~17 messages a minute, comfortably inside Telegram's ceiling with room for
 *  the occasional retry to fit without tipping over it. */
const SEND_INTERVAL_MS = 3_500;

/** Past this many waiting messages the feed has stopped being live, and
 *  sending them one at a time only widens the gap. Runs collapse instead. */
const DIGEST_THRESHOLD = 25;

/** A backlog this long means something is badly wrong — a stuck token, a
 *  channel the bot was removed from — and hoarding it forever would turn a
 *  bounded outage into unbounded storage. The oldest go. */
const MAX_QUEUE = 500;

export type { Queued } from "#api/telegram/digest";

export class Announcer extends DurableObject<Env> {
  /**
   * Take events. Never sends inline: the caller is a cron tick with a lock
   * and a deadline, and it should not be waiting on someone else's rate
   * limit.
   */
  async enqueue(items: Queued[]): Promise<number> {
    if (items.length === 0) return 0;
    const queue = await this.read();
    queue.push(...items);
    // Drop from the FRONT when over the cap. In a feed, the newest events are
    // the ones anyone is watching for; a backlog that discards them to
    // preserve an hour-old mint has its priorities backwards.
    const trimmed = queue.length > MAX_QUEUE ? queue.slice(queue.length - MAX_QUEUE) : queue;
    await this.ctx.storage.put("queue", trimmed);
    // Start draining if it is not already. An alarm that exists is a drain in
    // progress; setting it again would only move it later.
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now());
    }
    return trimmed.length;
  }

  async depth(): Promise<number> {
    return (await this.read()).length;
  }

  /** Drop everything waiting — for when a replay is queued by mistake and the
   *  channel should not receive it. */
  async drain(): Promise<number> {
    const n = (await this.read()).length;
    await this.ctx.storage.put("queue", []);
    await this.ctx.storage.deleteAlarm();
    return n;
  }

  async alarm(): Promise<void> {
    const queue = await this.read();
    if (queue.length === 0) return; // idle: no alarm, no cost

    const token = this.env.TELEGRAM_BOT_TOKEN;
    const chat = this.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) {
      // Unconfigured is not an error state to retry into forever — in dev
      // there is no bot, and a queue that never drains would grow until the
      // cap. Discard and stay quiet.
      await this.ctx.storage.put("queue", []);
      return;
    }

    const { announcement, rest } = nextAnnouncement(queue, DIGEST_THRESHOLD);
    const result = await send(token, chat, announcement);

    if (!result.ok && result.retryAfter !== null) {
      // Rate limited with a number attached. Keep the message, wait exactly
      // as long as we were told, and do not count it as an attempt.
      await this.ctx.storage.setAlarm(Date.now() + result.retryAfter * 1000 + 500);
      return;
    }

    // Anything else — sent, or failed for a reason waiting will not fix (a
    // deleted channel, a malformed caption) — moves on. Retrying a permanent
    // failure forever would block every message behind it.
    if (!result.ok) {
      console.error({ event: "announce_failed", error: result.error });
    }
    await this.ctx.storage.put("queue", rest);
    if (rest.length > 0) await this.ctx.storage.setAlarm(Date.now() + SEND_INTERVAL_MS);
  }

  private async read(): Promise<Queued[]> {
    return (await this.ctx.storage.get<Queued[]>("queue")) ?? [];
  }
}
