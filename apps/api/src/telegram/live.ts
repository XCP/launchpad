/**
 * What the channel says on a normal tick.
 *
 * Deliberately not a delta stream out of the indexer. The indexer already
 * knows which mints it just inserted, and threading that out would have been
 * the obvious design — but it makes the feed only as reliable as the tick that
 * saw the event. A crash between insert and send loses the announcement
 * forever, and there is no way to notice.
 *
 * This asks a different question: what SHOULD the channel have said by now,
 * and what has it not said yet? Chain transactions populate a small D1 outbox;
 * the queue accepts each stable event key once, and only then does D1 move the
 * key to `announced`. A missed tick or a failure between those systems is
 * repaired by the next one without repeating a post.
 */
import { ratio } from "@launchpad/xcp69/numeric";
import { q } from "#api/db";
import type { Env } from "#api/env";
import { fetchMempoolFairmints } from "#api/integrations/counterparty";
import {
  NEAR_MARKS,
  mintClosing,
  nearingSoldOut,
  type Announcement,
} from "#api/telegram/format";
import { buildBacklog } from "#api/telegram/replay";

/** How close to the deadline the countdown fires. */
const CLOSING_BLOCKS = 5;

export interface LiveResult {
  announced: number;
  queued: number;
}

interface MintingRow {
  tx_hash: string;
  asset: string;
  earned_quantity: string | null;
  soft_cap: string;
  current_deadline_block: number;
}

/**
 * Is the feed switched on?
 *
 * Off until the backlog has been replayed, because the live path and the
 * replay draw from the same well: with the past unclaimed, the first tick
 * would announce all of it, out of order and without the replay's pacing.
 */
async function isLive(db: D1Database): Promise<boolean> {
  const row = await q<{ value: string }>(
    db,
    `SELECT value FROM announce_state WHERE key = 'live'`,
  );
  return row[0]?.value === "1";
}

/**
 * A message ready for the Durable Object. `key` is a chain-derived identity,
 * so the object can turn two callers or a retry into one queue entry.
 */
export interface AnnouncementItem {
  key: string;
  a: Announcement;
  mintOf: string | null;
  earned: string;
  paid: string;
}

export interface QueueResult {
  /** Candidates D1 still considered unsaid at the start of this attempt. */
  accepted: number;
  /** Entries appended on this RPC; lower than accepted when repairing an
   * earlier queue acceptance whose D1 acknowledgement failed. */
  newlyQueued: number;
  /** Current Durable Object queue depth. */
  depth: number;
}

const D1_CHUNK = 50;

/** Remove keys D1 already acknowledged. This is an indexed point lookup, not
 * the concurrency decision -- the Durable Object makes that decision. */
async function onlyUnannounced<T extends { key: string }>(
  db: D1Database,
  items: T[],
): Promise<T[]> {
  const unique = [...new Map(items.map((item) => [item.key, item])).values()];
  const said = new Set<string>();
  for (let i = 0; i < unique.length; i += D1_CHUNK) {
    const chunk = unique.slice(i, i + D1_CHUNK);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const rows = await q<{ key: string }>(
      db,
      `SELECT key FROM announced WHERE key IN (${placeholders})`,
      ...chunk.map((item) => item.key),
    );
    for (const row of rows) said.add(row.key);
  }
  return unique.filter((item) => !said.has(item.key));
}

/** Record durable queue acceptance and retire its pending outbox row in the
 * same D1 batch. A failed batch leaves every key retryable; the queue's own
 * accepted-key marker prevents that retry from appending a duplicate. */
async function acknowledge(db: D1Database, keys: string[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`INSERT OR IGNORE INTO announced (key, at) VALUES (?1, ?2)`);
  const remove = db.prepare(`DELETE FROM announcement_work WHERE key = ?1`);
  // Two statements per key, hence fifty rather than the queue's hundred-item
  // chunk: each D1 batch stays at or below one hundred statements.
  for (let i = 0; i < keys.length; i += D1_CHUNK) {
    const chunk = keys.slice(i, i + D1_CHUNK);
    await db.batch(
      chunk.flatMap((key) => [insert.bind(key, now), remove.bind(key)]),
    );
  }
}

/** Retire outbox rows whose keys are already in `announced`. These exist
 * because the phase-transition trigger re-inserts `open:`/`closed:` keys on
 * every later transition, and a later fill re-inserts an already-announced
 * `trade-tx:` key. `acknowledge` can never reach them — it only sees keys
 * that pass the unannounced filter — so without this sweep they sit in
 * announcement_work forever, re-read and re-rendered on every tick: the
 * unbounded-history cost this outbox exists to prevent. Most keys here have
 * no outbox row at all (the live-only closing/near items); deleting a missing
 * key is an index seek that touches nothing. */
async function retireAlreadySaid(db: D1Database, keys: string[]): Promise<void> {
  const remove = db.prepare(`DELETE FROM announcement_work WHERE key = ?1`);
  for (let i = 0; i < keys.length; i += D1_CHUNK) {
    await db.batch(keys.slice(i, i + D1_CHUNK).map((key) => remove.bind(key)));
  }
}

/** Enqueue first, acknowledge second. This order is safe because the Durable
 * Object persists an accepted-key marker atomically with the queue append. */
export async function queueAnnouncements(
  env: Env,
  items: AnnouncementItem[],
): Promise<QueueResult> {
  const unsaid = await onlyUnannounced(env.DB, items);
  const unsaidKeys = new Set(unsaid.map((item) => item.key));
  const alreadySaid = [...new Set(items.map((item) => item.key))].filter(
    (key) => !unsaidKeys.has(key),
  );
  if (alreadySaid.length > 0) await retireAlreadySaid(env.DB, alreadySaid);
  if (unsaid.length === 0) {
    return { accepted: 0, newlyQueued: 0, depth: 0 };
  }

  const stub = env.ANNOUNCER.get(env.ANNOUNCER.idFromName("global"));
  const result = await stub.enqueue(unsaid);
  await acknowledge(env.DB, result.known);
  return {
    accepted: result.known.length,
    newlyQueued: result.newlyAccepted.length,
    depth: result.depth,
  };
}

export async function announceLive(env: Env, height: number): Promise<LiveResult> {
  if (!(await isLive(env.DB))) return { announced: 0, queued: 0 };

  const items: AnnouncementItem[] = [];

  // Everything with a chain fact behind it: launches, opens, mints, closes,
  // trades. Mint/trade history comes from the pending-work outbox, so this
  // costs work proportional to what is new rather than all-time history.
  for (const b of await buildBacklog(env.DB, height, true)) {
    items.push({
      key: b.key,
      a: b.a,
      // Only mints collapse — a digest is what falling behind looks like, and
      // nothing else here arrives in runs on one launch.
      mintOf: b.mint?.asset ?? null,
      earned: b.mint?.earned ?? "0",
      paid: b.mint?.paid ?? "0",
    });
  }

  // The two live-only messages. Neither is derivable from a row that exists or
  // does not; both are questions about where a launch sits RIGHT NOW, which is
  // why they are not in the replay.
  const minting = await q<MintingRow>(
    env.DB,
    `SELECT tx_hash, asset, earned_quantity, soft_cap, current_deadline_block
       FROM launches
      WHERE conforming = 1 AND phase = 'minting'`,
  );

  // Pass one: everything decidable from D1 alone, and a note of which launches
  // would need the mempool.
  const needsPending: { l: MintingRow; cap: bigint; mintedPct: number; mark: number }[] = [];
  for (const l of minting) {
    const cap = BigInt(l.soft_cap);
    if (cap <= 0n) continue;
    const earned = BigInt(l.earned_quantity ?? "0");
    // ratio() rather than a hand-rolled Number() on the division: it is the
    // module that exists to say "a double is the right answer here", it scales
    // through bigint so oversized operands keep their significant figures, and
    // the numeric check knows it is the sanctioned path.
    const mintedPct = ratio(earned, cap) * 100;

    const blocksLeft = l.current_deadline_block - height;
    if (blocksLeft > 0 && blocksLeft <= CLOSING_BLOCKS) {
      items.push({
        key: `closing:${l.tx_hash}`,
        a: mintClosing(l.asset, blocksLeft, earned, cap),
        mintOf: null,
        earned: "0",
        paid: "0",
      });
    }

    // The highest mark passed, not every mark passed: a launch that jumps from
    // 70% to 96% in one block has news, and it is "96", not a climb to it.
    const mark = [...NEAR_MARKS].reverse().find((m) => mintedPct >= m);
    if (mark !== undefined) needsPending.push({ l, cap, mintedPct, mark });
  }

  // Pass two: the mempool, and ONLY if a launch actually crossed a mark.
  //
  // This used to run whenever anything was minting, which is always — a
  // limit=500 request to a public Counterparty node every five minutes,
  // discarded unread on almost all of them. The pending share is used in
  // exactly one message, so it is fetched exactly when that message is about
  // to be written.
  if (needsPending.length > 0) {
    const pending = await fetchMempoolFairmints().catch(() => []);
    const pendingByAsset = new Map<string, bigint>();
    for (const m of pending) {
      pendingByAsset.set(
        m.asset,
        (pendingByAsset.get(m.asset) ?? 0n) + BigInt(String(m.earnQuantity)),
      );
    }
    for (const { l, cap, mintedPct, mark } of needsPending) {
      items.push({
        key: `near:${l.tx_hash}:${mark}`,
        a: nearingSoldOut(l.asset, mintedPct, ratio(pendingByAsset.get(l.asset) ?? 0n, cap) * 100),
        mintOf: null,
        earned: "0",
        paid: "0",
      });
    }
  }

  if (items.length === 0) return { announced: 0, queued: 0 };

  const queued = await queueAnnouncements(env, items);
  return { announced: queued.accepted, queued: queued.depth };
}
