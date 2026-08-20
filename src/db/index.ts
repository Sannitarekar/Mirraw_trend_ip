import { getConfig } from "../shared/config.ts";
import { runMigrations } from "./migrate.ts";
import { PgClient } from "./pg-adapter.ts";
import { PGliteClient } from "./pglite-adapter.ts";
import type { DbClient } from "./types.ts";

/**
 * Database factory.
 *
 * - `postgres://` / `postgresql://` DATABASE_URL -> real PostgreSQL (pg)
 * - empty DATABASE_URL or `pglite://`            -> embedded PGlite demo DB
 *
 * After creation you must call runMigrations() before using it.
 */
export function createDatabase(url?: string): DbClient {
  const cfg = getConfig();
  const databaseUrl = url ?? cfg.DATABASE_URL;
  if (databaseUrl && /^postgres(ql)?:\/\//i.test(databaseUrl)) {
    return new PgClient(databaseUrl);
  }
  // Tests use an in-memory PGlite instance; the demo persists to disk.
  const dataDir = cfg.NODE_ENV === "test" ? "" : cfg.PGLITE_DATA_DIR;
  return new PGliteClient(dataDir);
}

/** Open a database, apply migrations, and return a ready client. */
export async function openDatabase(url?: string): Promise<DbClient> {
  const db = createDatabase(url);
  await runMigrations(db);
  return db;
}

export type { DbClient, QueryResult } from "./types.ts";