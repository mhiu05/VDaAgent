import postgres from 'postgres';
export type Row = Record<string, unknown>;
export interface Driver {
  kind: 'postgres';
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  transaction<T>(fn: (tx: Driver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgresDriver(url: string): Driver {
  const hostname = new URL(url).hostname;
  const local = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  const client = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    // Supabase local Postgres does not expose TLS; every non-loopback connection requires it.
    ssl: local ? false : 'require',
  });
  const wrap = (sql: postgres.Sql | postgres.TransactionSql): Driver => ({
    kind: 'postgres',
    query: async (q, p = []) => Array.from(await sql.unsafe(q, p as never[])) as Row[],
    transaction: async (fn) =>
      'begin' in sql
        ? ((await (sql as postgres.Sql).begin(async (tx) => fn(wrap(tx)))) as never)
        : fn(wrap(sql)),
    close: async () => client.end(),
  });
  return wrap(client);
}
