import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../src/db/index.ts";
import type { DbClient } from "../../src/db/types.ts";

let db: DbClient;

before(async () => {
  db = await openDatabase(); // in-memory PGlite (DATABASE_URL empty in test env)
});

after(async () => {
  await db.close();
});

function seedImage(overrides: Partial<Record<string, unknown>> = {}) {
  const id = randomUUID();
  return {
    id,
    source: "pinterest",
    source_url: `https://pin.example/${id}`,
    image_url: `https://img.example/${id}.jpg`,
    ...overrides,
  };
}

test("migrations create all four tables and are tracked", async () => {
  const tables = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const names = tables.rows.map((r) => r.tablename);
  for (const expected of [
    "raw_trend_images",
    "trend_image_attributes",
    "trend_feed",
    "trend_image_usage",
    "schema_migrations",
  ]) {
    assert.ok(names.includes(expected), `table ${expected} exists`);
  }
  const applied = await db.query("SELECT filename FROM schema_migrations ORDER BY filename");
  assert.ok(applied.rows.length >= 4, "at least the four migration files recorded");
});

test("raw_trend_images enforces unique source_url (duplicate URL protection)", async () => {
  const row = seedImage();
  await db.query(
    `INSERT INTO raw_trend_images (id, source, source_url, image_url, raw_metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [row.id, row.source, row.source_url, row.image_url, JSON.stringify({})],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO raw_trend_images (id, source, source_url, image_url)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), row.source, row.source_url, "https://img.example/other.jpg"],
    ),
    /duplicate key/i,
    "second insert with same source_url must fail",
  );
});

test("raw_trend_images status is restricted to the pipeline enum", async () => {
  const row = seedImage();
  await assert.rejects(
    db.query(
      `INSERT INTO raw_trend_images (id, source, source_url, image_url, status)
       VALUES ($1,$2,$3,$4,$5)`,
      [row.id, row.source, row.source_url, row.image_url, "bogus_status"],
    ),
    /violates check constraint|check constraint/i,
  );
});

test("trend_image_attributes FK rejects orphan rows", async () => {
  await assert.rejects(
    db.query(
      `INSERT INTO trend_image_attributes (id, raw_image_id, garment_type)
       VALUES ($1,$2,$3)`,
      [randomUUID(), randomUUID(), "saree"],
    ),
    /foreign key|violates foreign/i,
    "attribute row cannot reference a missing raw image",
  );
});

test("one attributes row per image (UNIQUE raw_image_id)", async () => {
  const row = seedImage();
  await db.query(
    `INSERT INTO raw_trend_images (id, source, source_url, image_url)
     VALUES ($1,$2,$3,$4)`,
    [row.id, row.source, row.source_url, row.image_url],
  );
  const aId = randomUUID();
  await db.query(
    `INSERT INTO trend_image_attributes (id, raw_image_id, garment_type, color_palette)
     VALUES ($1,$2,$3,$4::text[])`,
    [aId, row.id, "lehenga", ["gold", "ivory"]],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO trend_image_attributes (id, raw_image_id) VALUES ($1,$2)`,
      [randomUUID(), row.id],
    ),
    /duplicate key/i,
  );
});

test("attributes cascade delete when the raw image is removed", async () => {
  const row = seedImage();
  await db.query(
    `INSERT INTO raw_trend_images (id, source, source_url, image_url)
     VALUES ($1,$2,$3,$4)`,
    [row.id, row.source, row.source_url, row.image_url],
  );
  await db.query(
    `INSERT INTO trend_image_attributes (id, raw_image_id) VALUES ($1,$2)`,
    [randomUUID(), row.id],
  );
  await db.query("DELETE FROM raw_trend_images WHERE id = $1", [row.id]);
  const orphans = await db.query(
    "SELECT 1 FROM trend_image_attributes WHERE raw_image_id = $1",
    [row.id],
  );
  assert.equal(orphans.rows.length, 0, "attributes removed with their raw image");
});

test("transactions roll back on error", async () => {
  await assert.rejects(
    db.inTransaction(async (tx) => {
      const row = seedImage();
      await tx.query(
        `INSERT INTO raw_trend_images (id, source, source_url, image_url)
         VALUES ($1,$2,$3,$4)`,
        [row.id, row.source, row.source_url, row.image_url],
      );
      throw new Error("boom");
    }),
    /boom/,
  );
  const rows = await db.query("SELECT 1 FROM raw_trend_images WHERE source_url LIKE '%tx-test%'");
  assert.equal(rows.rows.length, 0);
});

test("text[] and jsonb round-trip", async () => {
  const row = seedImage();
  await db.query(
    `INSERT INTO raw_trend_images (id, source, source_url, image_url, raw_metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [row.id, row.source, row.source_url, row.image_url, JSON.stringify({ saves: 900, board: "ethnic" })],
  );
  await db.query(
    `INSERT INTO trend_image_attributes (id, raw_image_id, color_palette, trend_score, phash)
     VALUES ($1,$2,$3::text[],$4,$5)`,
    [randomUUID(), row.id, ["ivory", "gold", "mint green"], 82.4, "a1b2c3".padEnd(64, "0")],
  );
  const result = await db.query(
    `SELECT a.color_palette, a.trend_score, a.phash, r.raw_metadata->>'saves' AS saves
     FROM trend_image_attributes a JOIN raw_trend_images r ON r.id = a.raw_image_id
     WHERE r.id = $1`,
    [row.id],
  );
  const rowOut = result.rows[0] as {
    color_palette: string[];
    trend_score: number;
    phash: string;
    saves: string;
  };
  assert.deepEqual(rowOut.color_palette, ["ivory", "gold", "mint green"]);
  assert.equal(rowOut.trend_score, 82.4);
  assert.equal(rowOut.saves, "900");
  assert.equal(rowOut.phash.length, 64);
});