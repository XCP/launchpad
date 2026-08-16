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
 * and what has it not said yet? The answer comes from D1's current state
 * minus the announced table, which means a missed tick is repaired by the next
 * one and a replay is just the first run of the same code.
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
 * Claim keys in one batch and return the ones this caller won.
 *
 * The claim IS the decision: `INSERT OR IGNORE` writes a row the first time
 * and nothing forever after, so "should this be announced" and "record that it
 * was" are a single atomic step rather than a check followed by a race.
 *
 * Chunked for the same reason every other batch in this worker is: a batch is
 * one implicit transaction and D1 bounds how much one can carry, so the limit
 * belongs on the batch rather than on how many events a block happens to
 * produce.
 */
const CLAIM_CHUNK = 100;

export async function claimKeys<T extends { key: string }>(
  db: D1Database,
  items: T[],
): Promise<T[]> {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`INSERT OR IGNORE INTO announced (key, at) VALUES (?1, ?2)`);
  const claimed: T[] = [];
  for (let i = 0; i < items.length; i += CLAIM_CHUNK) {
    const chunk = items.slice(i, i + CLAIM_CHUNK);
    const results = await db.batch(chunk.map((it) => stmt.bind(it.key, now)));
    chunk.forEach((it, idx) => {
      if ((results[idx]!.meta.rows_written ?? 0) > 0) claimed.push(it);
    });
  }
  return claimed;
}

export async function announceLive(env: Env, height: number): Promise<LiveResult> {
  if (!(await isLive(env.DB))) return { announced: 0, queued: 0 };

  interface Item {
    key: string;
    a: Announcement;
    mintOf: string | null;
    earned: string;
    paid: string;
  }
  const items: Item[] = [];

  // Everything with a chain fact behind it: launches, opens, mints, closes,
  // trades. Filtered in SQL to what has never been announced, so this costs
  // work proportional to what is new.
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

  // Claim, then queue what was claimed. The other order double-posts on a
  // retry: queued-but-unclaimed is invisible to the next tick, which would
  // queue it again.
  //
  // One batch, not one round trip per item. A block that lands forty mints
  // would otherwise spend forty sequential trips to D1 inside a tick that
  // holds a lock with a deadline — the same shape this repo already removed
  // from the indexer's upserts. rows_written still comes back per statement,
  // so which keys were actually claimed is unchanged.
  const claimed = await claimKeys(env.DB, items);
  if (claimed.length === 0) return { announced: 0, queued: 0 };

  const stub = env.ANNOUNCER.get(env.ANNOUNCER.idFromName("global"));
  const queued = await stub.enqueue(
    claimed.map((c) => ({ a: c.a, mintOf: c.mintOf, earned: "0", paid: "0" })),
  );
  return { announced: claimed.length, queued };
}
