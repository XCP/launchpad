import { DurableObject } from "cloudflare:workers";
import type { Env } from "#api/env";
import { mintDigest, type Announcement } from "#api/telegram/format";
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

interface Queued {
  a: Announcement;
  /** Set for mints so a run on one launch can be collapsed; null otherwise,
   *  which is what marks an event as never-collapsible. */
  mintOf: string | null;
  /** Raw token and XCP amounts, carried so a digest can be summed without
   *  parsing them back out of the rendered text. */
  earned: string;
  paid: string;
}

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

    const { announcement, rest } = this.next(queue);
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

  /**
   * The next thing to say, and what is left after saying it.
   *
   * Below the threshold this is just the head of the queue. Above it, a run of
   * consecutive mints on the same launch becomes one line — which is the
   * honest way to fall behind: the feed keeps up, and the size bar is drawn on
   * the run's TOTAL, so the shape still reads as the size of what happened
   * rather than the size of whichever mint happened to be first.
   */
  private next(queue: Queued[]): { announcement: Announcement; rest: Queued[] } {
    const head = queue[0]!;
    if (queue.length < DIGEST_THRESHOLD || head.mintOf === null) {
      return { announcement: head.a, rest: queue.slice(1) };
    }
    let n = 0;
    let earned = 0n;
    let paid = 0n;
    while (n < queue.length && queue[n]!.mintOf === head.mintOf) {
      earned += BigInt(queue[n]!.earned);
      paid += BigInt(queue[n]!.paid);
      n++;
    }
    if (n === 1) return { announcement: head.a, rest: queue.slice(1) };
    return {
      announcement: mintDigest(head.mintOf, n, earned, paid),
      rest: queue.slice(n),
    };
  }

  private async read(): Promise<Queued[]> {
    return (await this.ctx.storage.get<Queued[]>("queue")) ?? [];
  }
}
