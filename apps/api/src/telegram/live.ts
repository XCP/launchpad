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

  if (minting.length > 0) {
    // One mempool read for every launch rather than one each: the feed is
    // asking "what is pending" of the chain, not of a launch.
    const pending = await fetchMempoolFairmints().catch(() => []);
    const pendingByAsset = new Map<string, bigint>();
    for (const m of pending) {
      pendingByAsset.set(
        m.asset,
        (pendingByAsset.get(m.asset) ?? 0n) + BigInt(String(m.earnQuantity)),
      );
    }

    for (const l of minting) {
      const cap = BigInt(l.soft_cap);
      if (cap <= 0n) continue;
      const earned = BigInt(l.earned_quantity ?? "0");
      // ratio() rather than a hand-rolled Number() on the division: it is the
      // module that exists to say "a double is the right answer here", it
      // scales through bigint so oversized operands keep their significant
      // figures, and the numeric check knows it is the sanctioned path.
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

      // The highest mark passed, not every mark passed: a launch that jumps
      // 70% to 96% in one block has news, and it is "96", not three messages
      // climbing to it.
      const mark = [...NEAR_MARKS].reverse().find((m) => mintedPct >= m);
      if (mark !== undefined) {
        const pendingPct = ratio(pendingByAsset.get(l.asset) ?? 0n, cap) * 100;
        items.push({
          key: `near:${l.tx_hash}:${mark}`,
          a: nearingSoldOut(l.asset, mintedPct, pendingPct),
          mintOf: null,
          earned: "0",
          paid: "0",
        });
      }
    }
  }

  if (items.length === 0) return { announced: 0, queued: 0 };

  // Claim, then queue what was claimed. The other order double-posts on a
  // retry: queued-but-unclaimed is invisible to the next tick, which would
  // queue it again.
  const claimed: typeof items = [];
  const now = Math.floor(Date.now() / 1000);
  for (const item of items) {
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO announced (key, at) VALUES (?1, ?2)`,
    )
      .bind(item.key, now)
      .run();
    if ((res.meta.rows_written ?? 0) > 0) claimed.push(item);
  }
  if (claimed.length === 0) return { announced: 0, queued: 0 };

  const stub = env.ANNOUNCER.get(env.ANNOUNCER.idFromName("global"));
  const queued = await stub.enqueue(
    claimed.map((c) => ({ a: c.a, mintOf: c.mintOf, earned: "0", paid: "0" })),
  );
  return { announced: claimed.length, queued };
}
