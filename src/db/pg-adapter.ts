import pg from "pg";
import type { DbClient, QueryResult } from "./types.ts";

const { Pool } = pg;

/** Real PostgreSQL adapter backed by node-postgres (pg). */
export class PgClient implements DbClient {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const result = await this.pool.query(text, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  async exec(text: string): Promise<void> {
    await this.pool.query(text);
  }

  async inTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx: DbClient = {
        query: async (q, p) => {
          const r = await client.query(q, (p ?? []) as unknown[]);
          return { rows: r.rows, rowCount: r.rowCount ?? 0 };
        },
        exec: async (q) => {
          await client.query(q);
        },
        inTransaction: () => Promise.reject(new Error("nested transactions are not supported")),
        close: () => Promise.resolve(),
      };
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}