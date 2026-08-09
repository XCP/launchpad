/**
 * A cheap D1 lease so an overrunning poll can't overlap the next cron tick.
 * One row, one guarded UPDATE — costs a single write win-or-lose, never a
 * scan.
 */
export async function withLock(
  db: D1Database,
  leaseSeconds: number,
  run: () => Promise<unknown>,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO chain_state (key, value) VALUES ('poll_lock_until', '0')
       ON CONFLICT(key) DO NOTHING`,
    )
    .run();
  const claim = await db
    .prepare(
      `UPDATE chain_state SET value = ?1
       WHERE key = 'poll_lock_until' AND CAST(value AS INTEGER) < ?2`,
    )
    .bind(String(now + leaseSeconds), now)
    .run();
  if ((claim.meta.rows_written ?? 0) === 0) return false;

  try {
    await run();
  } finally {
    await db
      .prepare(`UPDATE chain_state SET value = '0' WHERE key = 'poll_lock_until'`)
      .run();
  }
  return true;
}
