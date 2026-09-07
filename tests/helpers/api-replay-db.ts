import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Real migrations/SQLite; only D1's asynchronous API shape is adapted. */
export function apiReplayDb() {
  const raw = new DatabaseSync(":memory:");
  const migrations = fileURLToPath(new URL("../../apps/api/migrations", import.meta.url));
  for (const file of readdirSync(migrations).filter(f => f.endsWith(".sql")).sort()) raw.exec(readFileSync(join(migrations, file), "utf8"));
  const prepare = (sql: string, binds: Array<string | number | null> = []) => ({
    bind(...values: Array<string | number | null>) { return prepare(sql, values); },
    async all() { return { results: raw.prepare(sql).all(...binds), success: true }; },
    async first(column?: string) { const row = raw.prepare(sql).get(...binds); return column ? row?.[column] ?? null : row ?? null; },
    async run() { const result = raw.prepare(sql).run(...binds); return { success: true, meta: { rows_written: Number(result.changes) } }; },
  });
  const db = {
    prepare,
    async batch(statements: Array<ReturnType<typeof prepare>>) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { raw, db };
}
