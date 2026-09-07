import { beforeEach, describe, expect, it } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { paceOrder } from "#api/queries/launches";

/**
 * Mint pace is the one sort key that is arithmetic rather than a column, so
 * it is the one worth running against real SQLite: the ordering has to be
 * right, and the expression has to parse at all.
 *
 * The question it answers is the one progress cannot. A launch at 24% is
 * doing well on day two and failing on day six, and every list the site
 * showed before this ranked those two the same.
 */

const WINDOW = 1_000;

let db: D1Database;

/** A minting launch: `funded` of its soft cap raised, window `start` to
 *  `start + WINDOW`. Soft cap is a round 1,000 so `funded` reads as a share. */
async function launch(asset: string, funded: number, start: number) {
  await db
    .prepare(
      `INSERT INTO launches (asset, soft_cap, earned_quantity, start_block, current_deadline_block)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(asset, "1000", String(Math.round(funded * 1000)), start, start + WINDOW)
    .run();
}

async function order(tip: number): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT asset FROM launches ORDER BY ${paceOrder(tip)}, asset ASC`)
    .all<{ asset: string }>();
  return results.map((r) => r.asset);
}

beforeEach(async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: `export default { fetch() { return new Response("ok") } }`,
      d1Databases: ["DB"],
    }),
  );
  db = await mf.getD1Database("DB");
  await db
    .prepare(
      `CREATE TABLE launches (
         asset TEXT PRIMARY KEY,
         soft_cap TEXT,
         earned_quantity TEXT,
         start_block INTEGER,
         current_deadline_block INTEGER
       )`,
    )
    .run();
});

describe("mint pace ordering", () => {
  it("ranks a young launch above an older one at the same progress", async () => {
    const tip = 100_000;
    // Both 30% funded. EARLY is 100 blocks into its window, LATE is 900.
    await launch("EARLY", 0.3, tip - 100);
    await launch("LATE", 0.3, tip - 900);
    expect(await order(tip)).toEqual(["EARLY", "LATE"]);
  });

  it("ranks by rate, not by how much was raised", async () => {
    const tip = 100_000;
    // AHEAD has raised less in total but is barely into its window.
    await launch("AHEAD", 0.1, tip - 50);
    await launch("BEHIND", 0.5, tip - 900);
    expect(await order(tip)).toEqual(["AHEAD", "BEHIND"]);
  });

  it("puts 1.0 exactly on schedule", async () => {
    const tip = 100_000;
    // Half funded, half the window gone.
    await launch("ONTIME", 0.5, tip - WINDOW / 2);
    const { results } = await db
      .prepare(
        `SELECT (CAST(earned_quantity AS REAL) / CAST(soft_cap AS REAL))
              * (current_deadline_block - start_block)
              / (${tip} - start_block) AS pace
           FROM launches`,
      )
      .all<{ pace: number }>();
    expect(results[0]!.pace).toBeCloseTo(1, 10);
  });

  it("sorts a launch with no elapsed window last rather than failing", async () => {
    const tip = 100_000;
    await launch("STARTED", 0.1, tip - 500);
    // Its first block has not landed yet: the rate is not a number.
    await launch("UNBEGUN", 0, tip);
    expect(await order(tip)).toEqual(["STARTED", "UNBEGUN"]);
  });

  it("survives a launch with no soft cap", async () => {
    await db
      .prepare(
        `INSERT INTO launches (asset, soft_cap, earned_quantity, start_block, current_deadline_block)
         VALUES ('NOCAP', '0', '0', 99000, 100000)`,
      )
      .run();
    await launch("REAL", 0.4, 99_500);
    expect(await order(100_000)).toEqual(["REAL", "NOCAP"]);
  });

  it("measures a launch whose window is not the standard 1,000 blocks", async () => {
    const tip = 100_000;
    // Same 40% raised, but SHORT's whole window is 200 blocks and it is
    // halfway through, while LONG is a tenth of the way into 2,000.
    await db
      .prepare(
        `INSERT INTO launches (asset, soft_cap, earned_quantity, start_block, current_deadline_block)
         VALUES ('SHORT', '1000', '400', ${tip - 100}, ${tip + 100}),
                ('LONG',  '1000', '400', ${tip - 200}, ${tip + 1800})`,
      )
      .run();
    // LONG is a tenth in with 40% raised — four times the pace of SHORT's
    // half-in 40%. Measuring both against a hard 1,000 would reverse this.
    expect(await order(tip)).toEqual(["LONG", "SHORT"]);
  });

  it("interpolates only an integer, whatever it is handed", () => {
    expect(paceOrder(100_000)).toContain("100000 > start_block");
    expect(paceOrder(Number.NaN)).toContain("0 > start_block");
    expect(paceOrder(1.9)).toContain("1 > start_block");
    expect(paceOrder(0)).not.toMatch(/[;']/);
  });
});
