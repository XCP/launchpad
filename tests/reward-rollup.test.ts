import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The programme account, precomputed, must equal the programme account
 * derived live.
 *
 * Entitlement comes from the first 10,000 conforming mints globally, and the
 * address predicate sits outside that set on purpose. That is why the live
 * read was the largest row reader on this database: it built the whole
 * eligible set to answer for one address, about 4,830 rows to return one row.
 * The rollup builds it once instead.
 *
 * Everything below is about the two folds agreeing, including where the set
 * SHRINKS — a launch that stops conforming takes its mints out, so this is not
 * an append-only rollup and a rebuild has to be able to remove an address.
 */

const MIGRATIONS = fileURLToPath(new URL("../apps/api/migrations", import.meta.url));

const ELIGIBLE_BY_SOURCE = `
  WITH eligible AS (
    SELECT m.tx_hash, m.launch_tx, m.block_index, m.tx_index,
           m.source, m.paid_quantity
      FROM launch_mints m
      JOIN launches l ON l.tx_hash = m.launch_tx AND l.conforming = 1
     ORDER BY m.block_index, COALESCE(m.tx_index, 0), m.tx_hash
     LIMIT 10000
  )
  SELECT source,
         COUNT(*) AS earned_mints,
         COUNT(DISTINCT launch_tx) AS launches,
         CAST(SUM(CAST(paid_quantity AS INTEGER)) AS TEXT) AS paid_quantity
    FROM eligible
   GROUP BY source`;

const LIVE_FOR_SOURCE = `
  WITH eligible AS (
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
   WHERE source = ?
   GROUP BY source`;

let db: DatabaseSync;

/** The rebuild, in the shape refreshRewardAccounts performs it. */
function rebuild(): { removed: string[] } {
  const computed = db.prepare(ELIGIBLE_BY_SOURCE).all() as Array<{
    source: string;
    earned_mints: number;
    launches: number;
    paid_quantity: string;
  }>;
  const stored = (db.prepare(`SELECT source FROM reward_accounts`).all() as Array<{ source: string }>).map(
    (r) => r.source,
  );
  const seen = new Set<string>();
  for (const row of computed) {
    seen.add(row.source);
    db.prepare(
      `INSERT INTO reward_accounts (source, earned_mints, launches, paid_quantity)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         earned_mints = excluded.earned_mints,
         launches = excluded.launches,
         paid_quantity = excluded.paid_quantity`,
    ).run(row.source, row.earned_mints, row.launches, row.paid_quantity);
  }
  const removed = stored.filter((s) => !seen.has(s));
  for (const source of removed) {
    db.prepare(`DELETE FROM reward_accounts WHERE source = ?`).run(source);
  }
  db.prepare(
    `INSERT INTO reward_account_state (id, built_at, sources) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, sources = excluded.sources`,
  ).run(1, computed.length);
  return { removed };
}

function launch(txHash: string, conforming: number, startBlock: number) {
  db.prepare(
    `INSERT INTO launches (tx_hash, tx_index, asset, source, divisible, start_block, end_block,
       price, quantity_by_price, hard_cap, soft_cap, max_mint_per_tx, premint_quantity,
       burn_payment, lock_quantity, lock_description, conforming, status, phase,
       current_deadline_block, seen_at_block, updated_at)
     VALUES (?, ?, ?, '1Creator', 1, ?, ?, '1', '1', '1', '1', '1', '0', 0, 0, 0, ?, 'open',
             'minting', ?, ?, 0)`,
  ).run(
    txHash,
    startBlock,
    `ASSET${startBlock}`,
    startBlock,
    startBlock + 100,
    conforming,
    startBlock + 100,
    startBlock,
  );
}

function mint(txHash: string, launchTx: string, source: string, block: number, paid: string) {
  db.prepare(
    `INSERT INTO launch_mints (tx_hash, launch_tx, block_index, tx_index, source, paid_quantity, earn_quantity)
     VALUES (?, ?, ?, ?, ?, ?, '1')`,
  ).run(txHash, launchTx, block, block, source, paid);
}

const live = (source: string) => db.prepare(LIVE_FOR_SOURCE).get(source) ?? null;
const rolled = (source: string) =>
  db
    .prepare(
      `SELECT source, earned_mints AS mints, launches, paid_quantity AS paid
         FROM reward_accounts WHERE source = ?`,
    )
    .get(source) ?? null;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  launch("launchA", 1, 100);
  launch("launchB", 1, 200);
  launch("launchC", 0, 300); // never conformed
  mint("m1", "launchA", "1Alice", 101, "500");
  mint("m2", "launchA", "1Alice", 102, "250");
  mint("m3", "launchB", "1Alice", 201, "100");
  mint("m4", "launchB", "1Bob", 202, "700");
  mint("m5", "launchC", "1Carol", 301, "900");
});

describe("the rollup and the live fold agree", () => {
  it("matches for an address that minted across several launches", () => {
    rebuild();
    expect(rolled("1Alice")).toEqual(live("1Alice"));
    expect(rolled("1Alice")).toMatchObject({ mints: 3, launches: 2, paid: "850" });
  });

  it("matches for an address with a single mint", () => {
    rebuild();
    expect(rolled("1Bob")).toEqual(live("1Bob"));
    expect(rolled("1Bob")).toMatchObject({ mints: 1, launches: 1, paid: "700" });
  });

  it("excludes mints on a launch that never conformed", () => {
    rebuild();
    // Carol only ever minted a non-conforming launch. Both folds say nothing.
    expect(live("1Carol")).toBeNull();
    expect(rolled("1Carol")).toBeNull();
  });

  it("says nothing about an address that never minted", () => {
    rebuild();
    expect(rolled("1Stranger")).toBeNull();
    expect(live("1Stranger")).toBeNull();
  });
});

describe("a rebuild tracks the set shrinking, not just growing", () => {
  it("removes an address whose only launch stopped conforming", () => {
    rebuild();
    expect(rolled("1Bob")).not.toBeNull();

    // A conformance verdict is re-derived and this launch loses it.
    db.prepare(`UPDATE launches SET conforming = 0 WHERE tx_hash = 'launchB'`).run();
    const { removed } = rebuild();

    expect(removed).toContain("1Bob");
    expect(rolled("1Bob")).toBeNull();
    expect(rolled("1Bob")).toEqual(live("1Bob"));
    // Alice keeps what launchA earned her and loses what launchB did.
    expect(rolled("1Alice")).toEqual(live("1Alice"));
    expect(rolled("1Alice")).toMatchObject({ mints: 2, launches: 1, paid: "750" });
  });

  it("picks up a launch that starts conforming", () => {
    rebuild();
    expect(rolled("1Carol")).toBeNull();

    db.prepare(`UPDATE launches SET conforming = 1 WHERE tx_hash = 'launchC'`).run();
    rebuild();

    expect(rolled("1Carol")).toEqual(live("1Carol"));
    expect(rolled("1Carol")).toMatchObject({ mints: 1, launches: 1, paid: "900" });
  });

  it("picks up new mints for an address already in the rollup", () => {
    rebuild();
    mint("m6", "launchA", "1Bob", 103, "50");
    rebuild();

    expect(rolled("1Bob")).toEqual(live("1Bob"));
    expect(rolled("1Bob")).toMatchObject({ mints: 2, launches: 2, paid: "750" });
  });
});

describe("the state row is what licenses the fast path", () => {
  it("is absent before any rebuild, so a read falls back to the live fold", () => {
    const state = db.prepare(`SELECT built_at FROM reward_account_state WHERE id = 1`).get();
    expect(state).toBeUndefined();
  });

  it("is present after a rebuild", () => {
    rebuild();
    const state = db.prepare(`SELECT sources FROM reward_account_state WHERE id = 1`).get() as {
      sources: number;
    };
    expect(state.sources).toBe(2);
  });

  it("admits only one state row", () => {
    rebuild();
    expect(() =>
      db.prepare(`INSERT INTO reward_account_state (id, built_at, sources) VALUES (2, 1, 1)`).run(),
    ).toThrow();
  });
});
