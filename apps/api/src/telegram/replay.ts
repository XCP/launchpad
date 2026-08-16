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
  asset: string;
  block_index: number;
  token_delta: string;
  xcp_delta: string;
  kind: string;
}

export async function buildBacklog(db: D1Database, height: number): Promise<BacklogItem[]> {
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
         JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1`,
    ),
    q<TradeRow>(
      db,
      `SELECT event, asset, block_index, token_delta, xcp_delta, kind
         FROM asset_events`,
    ),
  ]);

  const items: BacklogItem[] = [];

  for (const l of launches) {
    // announce_block is the launch's real age; start_block is a stand-in only
    // when the announcement block was never recovered.
    const announced = l.announce_block ?? l.start_block;
    items.push({
      key: `launch:${l.tx_hash}`,
      block: announced,
      rank: RANK.launch,
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
  const running = new Map<string, bigint>();
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
      a: mint({
        asset: m.asset,
        earnedRaw: earned,
        paidRaw: BigInt(m.paid_quantity),
        source: m.source,
        progress: cap > 0n ? Number((soFar * 10_000n) / cap) / 10_000 : null,
      }),
    });
  }

  for (const t of trades) {
    const tokens = abs(BigInt(t.token_delta));
    if (wholeTokens(tokens) < MIN_TOKENS) continue;
    items.push({
      key: `trade:${t.event}`,
      block: t.block_index,
      rank: RANK.trade,
      a: trade({
        asset: t.asset,
        buy: t.kind === "buy",
        tokenRaw: tokens,
        xcpRaw: abs(BigInt(t.xcp_delta)),
        // asset_events does not record which venue filled it, and guessing
        // would be worse than omitting it. Pool is the common case here.
        venue: "pool",
      }),
    });
  }

  return items.sort((a, b) => a.block - b.block || a.rank - b.rank);
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const wholeTokens = (raw: bigint) => raw / 100_000_000n;

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
