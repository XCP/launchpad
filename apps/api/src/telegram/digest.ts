/**
 * What to say next when the feed has fallen behind.
 *
 * Separate from the Durable Object that calls it, and free of any runtime
 * import, so it can be tested as what it is: a decision about wording. The
 * object owns storage, alarms and sending; this owns the one branch in the
 * whole queue, and it is the branch where a mistake is invisible — collapsing
 * one message too many, or summing a digest short, still produces something
 * that looks exactly like a message.
 */
import { mintDigest, type Announcement } from "#api/telegram/format";

export interface Queued {
  a: Announcement;
  /** The launch a mint belongs to, so a run on one can be collapsed. Null for
   *  everything else, which is what marks an event as never-collapsible. */
  mintOf: string | null;
  /** Raw token and XCP amounts, carried so a digest can be summed without
   *  parsing them back out of rendered text. */
  earned: string;
  paid: string;
}

/**
 * Below the threshold this is the head of the queue and nothing more. Above
 * it, a run of consecutive mints on the SAME launch becomes one line — the
 * honest way to fall behind — with the size bar drawn on the run's total, so
 * the shape still reads as the size of what happened rather than the size of
 * whichever mint happened to be first.
 */
export function nextAnnouncement(
  queue: Queued[],
  threshold: number,
): { announcement: Announcement; rest: Queued[] } {
  const head = queue[0]!;
  if (queue.length < threshold || head.mintOf === null) {
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
  // A run of one is not a run. Collapsing it would trade a mint's own message
  // — its minter, its progress — for a strictly worse summary of itself.
  if (n === 1) return { announcement: head.a, rest: queue.slice(1) };
  return {
    announcement: mintDigest(head.mintOf, n, earned, paid),
    rest: queue.slice(n),
  };
}
