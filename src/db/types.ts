/**
 * Storage-agnostic database client.
 *
 * TIP must run both against a real PostgreSQL (production/CI) and the embedded
 * PGlite demo database (zero-install local). Both adapters implement this
 * interface so every service in the platform talks to one shape and the same
 * SQL. Transactions are required by the /used endpoint for the 3x/month
 * concurrency guarantee.
 */
export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  /** Run a parameterized query and return its rows. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run one or more statements that return no rows (DDL, inserts). */
  exec(text: string): Promise<void>;
  /** Run `fn` inside a transaction (BEGIN/COMMIT/ROLLBACK). */
  inTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}