/**
 * The channel's backlog, in the order it happened.
 *
 * Everything this feed would have said if the bot had existed from the first
 * launch: announcements, opens, every mint, closes, and trades, sorted by the
 * block they happened in. Replayed rather than skipped because the alternative
 * — marking the past as already-said so the feed starts quiet — throws away
 * the only history the channel will ever have.
 *
 * Two things are deliberately NOT replayed:
 *
 *  - The five-block closing warning. It is a live affordance, useful because
 *    it arrives while you can still act; issued retroactively for a launch
 *    that closed weeks ago it is noise wearing the clothes of a warning.
 *  - Anything below the announce floor, so the backlog is filtered on the same
 *    rule as the live feed rather than being a different, noisier thing.
 */
import { q } from "#api/db";
import { fetchXcpUsd } from "#api/integrations/price";
import {
  MIN_TOKENS,
  mint,
  mintClosed,
  mintOpen,
  newLaunch,
  trade,
  type Announcement,
} from "#api/telegram/format";

/** A queued announcement plus the key that proves it has not been said. */
export interface BacklogItem {
  key: string;
  /** The block it happened in — the sort key, and the whole point of a
   *  chronological replay. */
  block: number;
  /** Orders events inside one block: a launch is announced before it opens,
   *  and opens before anything is minted from it. */
  rank: number;
  a: Announcement;
  /**
   * Set only on mints, and only so the queue can collapse a run of them into
   * one line when it falls behind. The ticker, because that is what a digest
   * is addressed to; and the amounts, because a digest sums them and parsing
   * them back out of rendered text would be absurd.
   */
  mint: { asset: string; earned: string; paid: string } | null;
}

const RANK = { launch: 0, open: 1, mint: 2, trade: 3, closed: 4 };

interface LaunchRow {
  tx_hash: string;
  asset: string;
  announce_block: number | null;
  start_block: number;
  phase: string;
  soft_cap: string;
  hard_cap: string;
  earned_quantity: string | null;
  mints: number;
  minters: number;
}

interface MintRow {
  tx_hash: string;
  launch_tx: string;
  asset: string;
  block_index: number;
  source: string;
  earn_quantity: string;
  paid_quantity: string;
  soft_cap: string;
}

interface TradeRow {
  event: string;
  tx_hash: string;
  event_index: number | null;
  address: string;
  asset: string;
  block_index: number;
  token_delta: string;
  xcp_delta: string;
  kind: string;
}

interface TradeGroup {
  txHash: string;
  address: string;
  asset: string;
  block: number;
  kind: string;
  tokenRaw: bigint;
  xcpRaw: bigint;
  fills: number;
  lastTokenRaw: bigint;
  lastXcpRaw: bigint;
  lastEventIndex: number;
  venue: "pool" | "book";
}

/**
 * Build the backlog, optionally only the part that has never been said.
 *
 * The same function serves the one-off replay and every tick after it, which
 * is the point: "what should the channel have said by now" is one question,
 * and the announced table is the only thing that distinguishes the first
 * answer from the rest. A separate live path would be a second implementation
 * of the same rules, free to drift from this one.
 *
 * `unannouncedOnly` pushes that filter into SQL rather than fetching
 * everything and discarding most of it. Announced is keyed by exactly the
 * strings built here, so each of these is a primary-key anti-join: work
 * proportional to what is new, not to how much has ever happened.
 */
export async function buildBacklog(
  db: D1Database,
  height: number,
  unannouncedOnly = false,
): Promise<BacklogItem[]> {
  const newLaunches = unannouncedOnly
    ? `AND NOT EXISTS (SELECT 1 FROM announced a WHERE a.key = 'launch:' || tx_hash)`
    : "";
  const newMints = unannouncedOnly
    ? `AND NOT EXISTS (SELECT 1 FROM announced a WHERE a.key = 'mint:' || m.tx_hash)`
    : "";
  const newTrades = unannouncedOnly
    ? `WHERE primary_actor = 1 AND tx_hash IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM announced a
            WHERE a.key = 'trade-tx:' || asset_events.tx_hash || ':' || asset_events.asset
         )`
    : "WHERE primary_actor = 1 AND tx_hash IS NOT NULL";

  const [launches, mints, trades] = await Promise.all([
    q<LaunchRow>(
      db,
      `SELECT tx_hash, asset, announce_block, start_block, phase, soft_cap,
              hard_cap, earned_quantity, mints, minters
         FROM launches WHERE conforming = 1`,
    ),
    q<MintRow>(
      db,
      `SELECT m.tx_hash, m.launch_tx, l.asset, m.block_index, m.source,
              m.earn_quantity, m.paid_quantity, l.soft_cap
         FROM launch_mints m
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
        WHERE 1 = 1 ${newMints}`,
    ),
    q<TradeRow>(
      db,
      `SELECT event, tx_hash, event_index, address, asset, block_index,
              token_delta, xcp_delta, kind
         FROM asset_events ${newTrades}`,
    ),
  ]);
  // Launches are read whole regardless: the running progress on a replayed
  // mint needs every earlier mint of that launch, and the open/closed keys are
  // derived from a row's phase rather than from its own existence. The table
  // is one row per launch, so this stays small by construction.
  void newLaunches;

  const items: BacklogItem[] = [];
  for (const l of launches) {
    // announce_block is the launch's real age; start_block is a stand-in only
    // when the announcement block was never recovered.
    const announced = l.announce_block ?? l.start_block;
    items.push({
      key: `launch:${l.tx_hash}`,
      block: announced,
      rank: RANK.launch,
      mint: null,
      a: newLaunch({
        asset: l.asset,
        startBlock: l.start_block,
        softCapRaw: BigInt(l.soft_cap),
        hardCapRaw: BigInt(l.hard_cap),
        // As of the block it was announced in, not today — otherwise every
        // historical launch reads "Open now".
        height: announced,
      }),
    });

    // Only launches that actually reached their start block ever opened.
    if (l.start_block <= height && l.phase !== "scheduled") {
      items.push({
        key: `open:${l.tx_hash}`,
        block: l.start_block,
        rank: RANK.open,
        mint: null,
        a: mintOpen(l.asset),
      });
    }

    if (l.phase === "graduated" || l.phase === "refunded") {
      items.push({
        // Closes have no block of their own on the row, so they sort at the
        // last thing that happened to the launch: after its final mint.
        key: `closed:${l.tx_hash}`,
        block: lastBlockFor(mints, l.tx_hash, l.start_block),
        rank: RANK.closed,
        mint: null,
        a: mintClosed({
          asset: l.asset,
          graduated: l.phase === "graduated",
          earnedRaw: BigInt(l.earned_quantity ?? "0"),
          mints: l.mints,
          minters: l.minters,
        }),
      });
    }
  }

  // Keyed by launch tx and not by asset: a ticker can be reused by a later
  // fairminter, and a progress bar that silently pooled two launches' mints
  // would be wrong in a way that still looked plausible.
  const softCapOf = new Map(launches.map((l) => [l.tx_hash, BigInt(l.soft_cap)]));
  // Running total per launch, so each replayed mint shows the progress it
  // showed at the time rather than the launch's final number.
  //
  // Seeded with what the launch had earned BEFORE this batch, which is the
  // whole point: on the live path `mints` holds only the mints not yet
  // announced, so starting every launch at zero made the percentage the
  // BATCH's contribution rather than the launch's progress. A launch with
  // twenty prior mints announced its twenty-first as "0.4% to soft cap" — the
  // size of that one mint — while /ASSET correctly showed the total.
  //
  // The seed is derived, not counted: `earned_quantity` is the launch's total
  // across every mint, so subtracting this batch's mints leaves what stood
  // before it. On a full replay the batch IS every mint, the subtraction
  // yields zero, and the behaviour is exactly what it was. Clamped at zero in
  // case the indexer has written mints it has not yet rolled into the total.
  const batched = new Map<string, bigint>();
  for (const m of mints) {
    batched.set(m.launch_tx, (batched.get(m.launch_tx) ?? 0n) + BigInt(m.earn_quantity));
  }
  const running = new Map<string, bigint>();
  for (const l of launches) {
    const before = BigInt(l.earned_quantity ?? "0") - (batched.get(l.tx_hash) ?? 0n);
    if (before > 0n) running.set(l.tx_hash, before);
  }
  for (const m of [...mints].sort((a, b) => a.block_index - b.block_index)) {
    const earned = BigInt(m.earn_quantity);
    const soFar = (running.get(m.launch_tx) ?? 0n) + earned;
    running.set(m.launch_tx, soFar);
    if (wholeTokens(earned) < MIN_TOKENS) continue;
    const cap = softCapOf.get(m.launch_tx) ?? 0n;
    items.push({
      key: `mint:${m.tx_hash}`,
      block: m.block_index,
      rank: RANK.mint,
      mint: { asset: m.asset, earned: earned.toString(), paid: m.paid_quantity },
      a: mint({
        asset: m.asset,
        earnedRaw: earned,
        paidRaw: BigInt(m.paid_quantity),
        source: m.source,
        progress: cap > 0n ? Number((soFar * 10_000n) / cap) / 10_000 : null,
      }),
    });
  }

  const groupedTrades = new Map<string, TradeGroup>();
  for (const t of trades) {
    const tokenRaw = abs(BigInt(t.token_delta));
    const xcpRaw = abs(BigInt(t.xcp_delta));
    const key = `${t.tx_hash}:${t.asset}:${t.address}:${t.kind}`;
    const eventIndex = t.event_index ?? 0;
    const current = groupedTrades.get(key);
    if (!current) {
      groupedTrades.set(key, {
        txHash: t.tx_hash,
        address: t.address,
        asset: t.asset,
        block: t.block_index,
        kind: t.kind,
        tokenRaw,
        xcpRaw,
        fills: 1,
        lastTokenRaw: tokenRaw,
        lastXcpRaw: xcpRaw,
        lastEventIndex: eventIndex,
        venue: t.event.includes("_") ? "book" : "pool",
      });
      continue;
    }
    current.tokenRaw += tokenRaw;
    current.xcpRaw += xcpRaw;
    current.fills += 1;
    if (eventIndex >= current.lastEventIndex) {
      current.lastTokenRaw = tokenRaw;
      current.lastXcpRaw = xcpRaw;
      current.lastEventIndex = eventIndex;
      current.venue = t.event.includes("_") ? "book" : "pool";
    }
  }

  // One cached quote for the whole batch, and no request at all on the usual
  // tick where there are no qualifying transaction totals to announce.
  const xcpUsd = [...groupedTrades.values()].some(
    (t) => wholeTokens(t.tokenRaw) >= MIN_TOKENS,
  )
    ? await fetchXcpUsd()
    : null;

  for (const t of groupedTrades.values()) {
    if (wholeTokens(t.tokenRaw) < MIN_TOKENS) continue;
    items.push({
      key: `trade-tx:${t.txHash}:${t.asset}`,
      block: t.block,
      rank: RANK.trade,
      mint: null,
      a: trade({
        asset: t.asset,
        buy: t.kind === "buy",
        tokenRaw: t.tokenRaw,
        xcpRaw: t.xcpRaw,
        fills: t.fills,
        marketTokenRaw: t.lastTokenRaw,
        marketXcpRaw: t.lastXcpRaw,
        xcpUsd,
        txHash: t.txHash,
        address: t.address,
        venue: t.venue,
      }),
    });
  }

  return items.sort((a, b) => a.block - b.block || a.rank - b.rank);
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const wholeTokens = (raw: bigint) => raw / 100_000_000n;

/** Pool events begin with their transaction hash (a later fill may add its
 * event index). Order matches are tx0_tx1; tx1 completed the match. */
export function eventTxHash(event: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(event)) return event;
  const pool = event.match(/^([0-9a-f]{64})#/i);
  if (pool?.[1]) return pool[1];
  const match = event.match(/^[0-9a-f]{64}_([0-9a-f]{64})$/i);
  return match?.[1] ?? null;
}

/** A close has no block of its own on the row, so it sorts at the last thing
 *  that happened to THAT launch — its final mint, or its start block if it
 *  never took one. Matching on launch_tx and not on asset: an asset name is
 *  reusable across fairminters, a tx hash is not. */
function lastBlockFor(mints: MintRow[], launchTx: string, fallback: number): number {
  let last = fallback;
  for (const m of mints) {
    if (m.launch_tx === launchTx && m.block_index > last) last = m.block_index;
  }
  return last;
}
