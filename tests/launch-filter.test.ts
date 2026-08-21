import { describe, expect, it } from "vitest";
import { listLaunchPage } from "#api/queries/launches";

interface CapturedStatement {
  sql: string;
  bindings: unknown[];
  bind: (...values: unknown[]) => CapturedStatement;
}

function captureDb() {
  const statements: CapturedStatement[] = [];
  const db = {
    prepare(sql: string) {
      const statement: CapturedStatement = {
        sql,
        bindings: [],
        bind(...values: unknown[]) {
          statement.bindings = values;
          return statement;
        },
      };
      statements.push(statement);
      return statement;
    },
    async batch() {
      return [{ results: [] }, { results: [{ n: 0 }] }, { results: [] }];
    },
  } as unknown as Parameters<typeof listLaunchPage>[0];
  return { db, statements };
}

describe("launch unminted filter", () => {
  it("filters the page, total, and minting crown before pagination", async () => {
    const { db, statements } = captureDb();
    const address = "bc1qexamplewalletaddress000000000000000000";

    await listLaunchPage(db, "minting", "progress", 12, 24, address);

    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement.sql).toContain("NOT EXISTS");
      expect(statement.sql).toContain("m.launch_tx = launches.tx_hash");
      expect(statement.sql).toContain("m.source = ?");
      expect(statement.bindings).toContain(address);
    }
    expect(statements[0]!.bindings).toEqual(["minting", 12, 24, address]);
    expect(statements[1]!.bindings).toEqual(["minting", address]);
    expect(statements[2]!.bindings).toEqual([address]);
  });

  it("leaves the shared launch query untouched without a wallet filter", async () => {
    const { db, statements } = captureDb();

    await listLaunchPage(db, "graduated", "mcap", 8, 0);

    expect(statements).toHaveLength(2);
    expect(statements.every((statement) => !statement.sql.includes("launch_mints"))).toBe(true);
    expect(statements[0]!.bindings).toEqual(["graduated", 8, 0]);
    expect(statements[1]!.bindings).toEqual(["graduated"]);
  });
});
