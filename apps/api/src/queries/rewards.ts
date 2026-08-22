import { one, q } from "#api/db";

/** Raw divisible MINTS units awarded for one eligible mint transaction. */
export const REWARD_PER_MINT_RAW = 10_000_000_000n;

interface EarningRow {
  source: string;
  mints: number;
  launches: number;
  paid: string;
}

interface PayoutRow {
  batch_id: string;
  asset: string;
  first_mint_number: number;
  cutoff_mint_number: number;
  mint_count: number;
  quantity: string;
  tx_hash: string;
  method: RewardTransactionMethod;
  tx_status: RewardTransactionStatus;
  confirmed_block: number | null;
}

export type RewardTransactionMethod = "mpma" | "enhanced_send";
export type RewardTransactionStatus = "broadcast" | "confirmed" | "replaced" | "failed";
export type VisibleRewardTransactionStatus = Extract<
  RewardTransactionStatus,
  "broadcast" | "confirmed"
>;

export interface RewardPayout {
  batch_id: string;
  asset: string;
  first_mint_number: number;
  cutoff_mint_number: number;
  mint_count: number;
  quantity: string;
  tx_hash: string;
  method: RewardTransactionMethod;
  status: VisibleRewardTransactionStatus;
  confirmed_block: number | null;
}

export interface RewardAccount {
  source: string;
  earned_mints: number;
  launches: number;
  committed_xcp: string;
  lifetime_earned_quantity: string;
  paid_quantity: string;
  sent_pending_quantity: string;
  awaiting_quantity: string;
  has_reward_tx: boolean;
  payouts: RewardPayout[];
}

/**
 * The address's programme account, not its live MINTS balance.
 *
 * Entitlement is derived from the first 10,000 conforming mint transactions
 * globally. The source predicate therefore belongs OUTSIDE the eligibility
 * CTE: applying it first would give every address its own private 10,000-mint
 * programme. Payout history only includes rows attached to a real tx.
 */
export async function getRewardAccount(
  db: D1Database,
  source: string,
): Promise<RewardAccount | null> {
  const [earned, paidRows] = await Promise.all([
    one<EarningRow>(
      db,
      `WITH eligible AS (
         SELECT m.tx_hash, m.launch_tx, m.block_index, m.tx_index,
                m.source, m.paid_quantity
           FROM launch_mints m
           JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
          ORDER BY m.block_index, COALESCE(m.tx_index, 0), m.tx_hash
          LIMIT 10000
       )
       SELECT source,
              COUNT(*) AS mints,
              COUNT(DISTINCT launch_tx) AS launches,
              CAST(SUM(CAST(paid_quantity AS INTEGER)) AS TEXT) AS paid
         FROM eligible
        WHERE source = ?1
        GROUP BY source`,
      source,
    ),
    q<PayoutRow>(
      db,
      `SELECT p.batch_id, b.asset, b.first_mint_number, b.cutoff_mint_number,
              p.mint_count, p.quantity, t.tx_hash, t.method,
              t.status AS tx_status, t.confirmed_block
         FROM reward_payouts p
         JOIN reward_batches b ON b.id = p.batch_id
         JOIN reward_transactions t ON t.tx_hash = p.reward_tx_hash
        WHERE p.address = ?1
          AND t.status IN ('broadcast', 'confirmed')
        ORDER BY b.cutoff_mint_number DESC, t.tx_hash`,
      source,
    ),
  ]);

  if (!earned) return null;

  let confirmed = 0n;
  let pending = 0n;
  const payouts = paidRows.map((row): RewardPayout => {
    const quantity = BigInt(row.quantity);
    if (row.tx_status === "confirmed") confirmed += quantity;
    else pending += quantity;
    return {
      batch_id: row.batch_id,
      asset: row.asset,
      first_mint_number: row.first_mint_number,
      cutoff_mint_number: row.cutoff_mint_number,
      mint_count: row.mint_count,
      quantity: row.quantity,
      tx_hash: row.tx_hash,
      method: row.method,
      // The query admits only these two public states. Replaced/failed rows
      // remain operator audit data and are not payout history.
      status: row.tx_status as VisibleRewardTransactionStatus,
      confirmed_block: row.confirmed_block,
    };
  });
  const lifetime = BigInt(earned.mints) * REWARD_PER_MINT_RAW;
  const awaiting = lifetime > confirmed + pending ? lifetime - confirmed - pending : 0n;

  return {
    source: earned.source,
    earned_mints: earned.mints,
    launches: earned.launches,
    committed_xcp: earned.paid,
    lifetime_earned_quantity: lifetime.toString(),
    paid_quantity: confirmed.toString(),
    sent_pending_quantity: pending.toString(),
    awaiting_quantity: awaiting.toString(),
    has_reward_tx: payouts.length > 0,
    payouts,
  };
}

interface BatchRow {
  id: string;
  asset: string;
  first_mint_number: number;
  cutoff_mint_number: number;
  cutoff_block: number;
  eligible_mints: number;
  recipient_count: number;
  total_quantity: string;
  sent_recipient_count: number;
  sent_quantity: string;
  status: "frozen" | "broadcast" | "confirmed" | "failed";
  created_at: number;
  broadcast_at: number | null;
  confirmed_at: number | null;
  tx_hash: string;
  method: RewardTransactionMethod;
  tx_status: RewardTransactionStatus;
  btc_fee_sats: number | null;
  recoverable_sats: number | null;
  confirmed_block: number | null;
}

export interface RewardBatchTransaction {
  tx_hash: string;
  method: RewardTransactionMethod;
  status: RewardTransactionStatus;
  btc_fee_sats: number | null;
  recoverable_sats: number | null;
  confirmed_block: number | null;
}

export interface RewardBatch {
  id: string;
  asset: string;
  first_mint_number: number;
  cutoff_mint_number: number;
  cutoff_block: number;
  eligible_mints: number;
  recipient_count: number;
  total_quantity: string;
  sent_recipient_count: number;
  sent_quantity: string;
  status: "frozen" | "broadcast" | "confirmed" | "failed";
  created_at: number;
  broadcast_at: number | null;
  confirmed_at: number | null;
  transactions: RewardBatchTransaction[];
}

/** Public distribution history. A frozen manifest without a tx is omitted. */
export async function listRewardBatches(db: D1Database): Promise<RewardBatch[]> {
  const rows = await q<BatchRow>(
    db,
    `SELECT b.id, b.asset, b.first_mint_number, b.cutoff_mint_number,
            b.cutoff_block, b.eligible_mints, b.recipient_count,
            b.total_quantity,
            (SELECT COUNT(*)
               FROM reward_payouts p
               JOIN reward_transactions pt ON pt.tx_hash = p.reward_tx_hash
              WHERE p.batch_id = b.id
                AND pt.status IN ('broadcast', 'confirmed')) AS sent_recipient_count,
            COALESCE((SELECT CAST(SUM(CAST(p.quantity AS INTEGER)) AS TEXT)
               FROM reward_payouts p
               JOIN reward_transactions pt ON pt.tx_hash = p.reward_tx_hash
              WHERE p.batch_id = b.id
                AND pt.status IN ('broadcast', 'confirmed')), '0') AS sent_quantity,
            b.status, b.created_at, b.broadcast_at,
            b.confirmed_at, t.tx_hash, t.method, t.status AS tx_status,
            t.btc_fee_sats, t.recoverable_sats, t.confirmed_block
       FROM reward_batches b
       JOIN reward_transactions t ON t.batch_id = b.id
      WHERE t.status IN ('broadcast', 'confirmed')
      ORDER BY b.cutoff_mint_number DESC, t.tx_hash`,
  );

  const grouped = new Map<string, RewardBatch>();
  for (const row of rows) {
    let batch = grouped.get(row.id);
    if (!batch) {
      batch = {
        id: row.id,
        asset: row.asset,
        first_mint_number: row.first_mint_number,
        cutoff_mint_number: row.cutoff_mint_number,
        cutoff_block: row.cutoff_block,
        eligible_mints: row.eligible_mints,
        recipient_count: row.recipient_count,
        total_quantity: row.total_quantity,
        sent_recipient_count: row.sent_recipient_count,
        sent_quantity: row.sent_quantity,
        status: row.status,
        created_at: row.created_at,
        broadcast_at: row.broadcast_at,
        confirmed_at: row.confirmed_at,
        transactions: [],
      };
      grouped.set(row.id, batch);
    }
    batch.transactions.push({
      tx_hash: row.tx_hash,
      method: row.method,
      status: row.tx_status,
      btc_fee_sats: row.btc_fee_sats,
      recoverable_sats: row.recoverable_sats,
      confirmed_block: row.confirmed_block,
    });
  }
  return [...grouped.values()];
}
