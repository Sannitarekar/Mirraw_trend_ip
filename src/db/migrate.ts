import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DbClient } from "./types.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../db/migrations", import.meta.url));

/**
 * Minimal forward-only migration runner.
 *
 * Tracks applied files in a `schema_migrations` table. Runs every *.sql file
 * in lexical order exactly once. Works identically on real PostgreSQL and
 * PGlite because all migrations use portable SQL.
 */
export async function runMigrations(db: DbClient, migrationsDir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const applied = new Set(
    (await db.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await db.exec(sql);
    await db.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    ran.push(file);
  }
  return ran;
}