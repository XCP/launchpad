import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * What SQLite actually does with the reads that run most often.
 *
 * A query whose results are right and whose plan is wrong looks fine in every
 * other test and shows up only as a bill. This one applies the real migration
 * history to a real SQLite and asserts the plan, so an index that gets dropped,
 * renamed, or ordered differently fails here rather than in production D1 a day
 * later.
 *
 * The reads pinned below were the ones production insights named. `USE TEMP
 * B-TREE FOR ORDER BY` is the specific thing being kept out: it means every row
 * matching the WHERE is read and sorted before LIMIT takes its slice, so the
 * work grows with the phase instead of with the page.
 */

const MIGRATIONS = fileURLToPath(new URL("../apps/api/migrations", import.meta.url));

let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
});

/** The plan for one statement, as the lines SQLite prints. */
function plan(sql: string, ...params: (string | number)[]): string[] {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => String((row as { detail: string }).detail));
}

describe("listing a phase by soonest start", () => {
  // The ordering listLaunchPage uses for `scheduled`, and the sort key
  // SORT_SQL.soonest names. Production: 2,141 runs a day, 128,430 rows read,
  // efficiency 0.19 — about sixty rows read to return eleven.
  const SQL = `SELECT tx_hash, asset, phase, start_block, tx_index FROM launches
     WHERE conforming = 1 AND phase = ?1
     ORDER BY start_block ASC, tx_index DESC
     LIMIT ?2 OFFSET ?3`;

  it("seeks the phase rather than sorting it", () => {
    const detail = plan(SQL, "scheduled", 12, 0);
    expect(detail.join(" | ")).toContain("idx_launches_soonest");
  });

  it("builds no temp b-tree, so the cost follows the page and not the phase", () => {
    const detail = plan(SQL, "scheduled", 12, 0);
    expect(detail.some((line) => line.includes("TEMP B-TREE"))).toBe(false);
  });

  it("still seeks on a deep page", () => {
    // OFFSET makes SQLite walk what it skips, which is a real cost but a
    // smaller one than sorting the phase. What matters is that it is still a
    // seek down the index rather than a sort of everything.
    const detail = plan(SQL, "minting", 12, 240);
    expect(detail.join(" | ")).toContain("idx_launches_soonest");
    expect(detail.some((line) => line.includes("TEMP B-TREE"))).toBe(false);
  });
});

describe("the tradeable set", () => {
  // listTradeableAssets: the swap and limit pages' token list, read once per
  // render instead of being re-derived from a public Counterparty node.
  const SQL = `SELECT asset, pool_xcp_sats FROM launches
     WHERE conforming = 1 AND phase = 'graduated' AND pool_xcp_sats > 0
     ORDER BY pool_xcp_sats DESC`;

  it("seeks conforming graduated rows rather than scanning the table", () => {
    const detail = plan(SQL);
    expect(detail.join(" | ")).toMatch(/SEARCH launches USING (COVERING )?INDEX/);
    expect(detail.some((line) => line.includes("SCAN launches"))).toBe(false);
  });

  it("sorts only the rows it found", () => {
    // A temp b-tree is acceptable here and nowhere else on this table: the set
    // is the graduated launches, which is bounded and small, and no index can
    // order by pool depth without being rewritten on every pool change.
    const detail = plan(SQL);
    expect(detail.join(" | ")).toContain("idx_launches_listed");
  });
});

describe("the indexes these plans depend on", () => {
  it("exist under the names the plans name", () => {
    const names = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'launches'`)
      .all()
      .map((row) => String((row as { name: string }).name));

    expect(names).toContain("idx_launches_soonest");
    expect(names).toContain("idx_launches_listed");
    expect(names).toContain("idx_launches_rank");
  });

  it("keeps the soonest index partial, so non-conforming rows stay out of it", () => {
    const sql = String(
      (
        db
          .prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_launches_soonest'`)
          .get() as { sql: string }
      ).sql,
    );
    expect(sql).toContain("WHERE conforming = 1");
  });
});
