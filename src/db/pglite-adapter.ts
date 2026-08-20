import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { DbClient, QueryResult } from "./types.ts";

/**
 * Embedded PostgreSQL adapter.
 *
 * PGlite is PostgreSQL compiled to WASM. It executes the same SQL as a real
 * server, which lets the demo run with zero installation while keeping the
 * migrations and queries 100% production PostgreSQL.
 *
 * dataDir: filesystem directory for persistence, or empty for in-memory (tests).
 */
export class PGliteClient implements DbClient {
  private readonly db: PGlite;

  constructor(dataDir: string = "") {
    if (dataDir) {
      mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
      this.db = new PGlite(path.resolve(dataDir));
    } else {
      this.db = new PGlite();
    }
  }

  async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const result = await this.db.query(text, params);
    return { rows: result.rows as T[], rowCount: result.rows.length };
  }

  async exec(text: string): Promise<void> {
    await this.db.exec(text);
  }

  async inTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const wrapped: DbClient = {
        query: async <Q = Record<string, unknown>>(q: string, p?: unknown[]) => {
          const r = await tx.query(q, p);
          return { rows: r.rows as Q[], rowCount: r.rows.length };
        },
        exec: async (q) => {
          await tx.exec(q);
        },
        inTransaction: () => Promise.reject(new Error("nested transactions are not supported")),
        close: () => Promise.resolve(),
      };
      return fn(wrapped);
    });
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}