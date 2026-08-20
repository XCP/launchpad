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

/** Every queued event carries the chain-derived identity D1 uses for the same
 * fact. The queue is the cross-system idempotency boundary: accepting the same
 * key twice returns the first acceptance instead of appending a second post. */
export interface KeyedQueued extends Queued {
  key: string;
}

export interface EnqueueResult {
  /** Current queue length after the cap is applied. */
  depth: number;
  /** Keys appended by this call. */
  newlyAccepted: string[];
  /** Every supplied key now durably known, including retries of an earlier
   * acceptance whose D1 acknowledgement failed. */
  known: string[];
}

const ACCEPTED_PREFIX = "accepted:";
const STORAGE_CHUNK = 100;
type StoredQueued = Queued & { key?: string };

export class Announcer extends DurableObject<Env> {
  /**
   * Take events. Never sends inline: the caller is a cron tick with a lock
   * and a deadline, and it should not be waiting on someone else's rate
   * limit.
   */
  async enqueue(items: KeyedQueued[]): Promise<EnqueueResult> {
    if (items.length === 0) {
      return { depth: (await this.read()).length, newlyAccepted: [], known: [] };
    }

    // One key once even if a malformed caller repeats it inside one RPC. The
    // Durable Object serializes calls, and the storage transaction makes the
    // accepted marker and queue append one decision across transaction retries.
    const unique = [...new Map(items.map((item) => [item.key, item])).values()];
    return this.ctx.storage.transaction(async (txn) => {
      const storageKeys = unique.map((item) => `${ACCEPTED_PREFIX}${item.key}`);
      const accepted = new Set<string>();
      for (let i = 0; i < storageKeys.length; i += STORAGE_CHUNK) {
        const found = await txn.get<number>(storageKeys.slice(i, i + STORAGE_CHUNK));
        for (const key of found.keys()) accepted.add(key);
      }

      const fresh = unique.filter(
        (item) => !accepted.has(`${ACCEPTED_PREFIX}${item.key}`),
      );
      const queue = ((await txn.get<StoredQueued[]>("queue")) ?? []).concat(fresh);
      // Drop from the FRONT when over the cap. In a feed, the newest events
      // are the ones anyone is watching for; a backlog that discards them to
      // preserve an hour-old mint has its priorities backwards.
      const trimmed = queue.length > MAX_QUEUE ? queue.slice(queue.length - MAX_QUEUE) : queue;
      await txn.put("queue", trimmed);

      const now = Date.now();
      for (let i = 0; i < fresh.length; i += STORAGE_CHUNK) {
        const markers = Object.fromEntries(
          fresh
            .slice(i, i + STORAGE_CHUNK)
            .map((item) => [`${ACCEPTED_PREFIX}${item.key}`, now]),
        );
        if (Object.keys(markers).length > 0) await txn.put(markers);
      }

      // Start draining if it is not already. An alarm that exists is a drain
      // in progress; setting it again would only move it later.
      if ((await txn.getAlarm()) === null) await txn.setAlarm(Date.now());

      return {
        depth: trimmed.length,
        newlyAccepted: fresh.map((item) => item.key),
        known: unique.map((item) => item.key),
      };
    });
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

  private async read(): Promise<StoredQueued[]> {
    return (await this.ctx.storage.get<StoredQueued[]>("queue")) ?? [];
  }
}
