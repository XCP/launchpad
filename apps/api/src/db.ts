/** Typed D1 helpers — the one place a query result acquires a type. */
export const q = <T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> =>
  db
    .prepare(sql)
    .bind(...binds)
    .all<T>()
    .then((r) => r.results);

export const one = <T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> =>
  db
    .prepare(sql)
    .bind(...binds)
    .first<T>();
