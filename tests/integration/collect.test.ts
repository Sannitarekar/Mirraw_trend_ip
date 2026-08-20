import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openDatabase } from "../../src/db/index.ts";
import type { DbClient } from "../../src/db/types.ts";
import { LocalDiskStorage } from "../../src/storage/local-disk.ts";
import { collectFromSource } from "../../src/collectors/common/collect.ts";
import { InstagramCsvAdapter } from "../../src/collectors/instagram-csv/index.ts";
import type { RawSourceItem, SourceAdapter } from "../../src/collectors/common/types.ts";
import { parseCsv } from "../../src/collectors/common/csv.ts";

let db: DbClient;
let storage: LocalDiskStorage;
let imagesDir: string;

before(async () => {
  db = await openDatabase();
  imagesDir = mkdtempSync(path.join(tmpdir(), "tip-images-"));
  storage = new LocalDiskStorage(mkdtempSync(path.join(tmpdir(), "tip-store-")), "http://localhost:3000/files");
  // A valid 2x2 PNG used as a downloadable fixture.
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
  writeFileSync(path.join(imagesDir, "a.png"), png);
  writeFileSync(path.join(imagesDir, "b.png"), png);
});

after(async () => {
  await db.close();
});

function fileUrl(name: string): string {
  return "file:///" + path.join(imagesDir, name).replaceAll("\\", "/");
}

function fakeAdapter(items: RawSourceItem[]): SourceAdapter {
  return {
    source: "fake",
    fetchRaw: async () => items,
  };
}

test("collectFromSource saves valid items as pending", async () => {
  const summary = await collectFromSource(
    fakeAdapter([
      { sourceUrl: "https://x/1", imageUrl: fileUrl("a.png"), raw: { saves: 10 } },
      { sourceUrl: "https://x/2", imageUrl: fileUrl("b.png"), raw: { saves: 20 } },
    ]),
    { db, storage },
  );
  assert.equal(summary.fetched, 2);
  assert.equal(summary.saved, 2);
  assert.equal(summary.failed, 0);

  const rows = await db.query("SELECT * FROM raw_trend_images WHERE source='fake'");
  assert.equal(rows.rows.length, 2);
  const first = rows.rows[0] as Record<string, unknown>;
  assert.equal(first["status"], "pending");
  assert.equal(first["source_url"], "https://x/1");
  assert.ok(typeof first["image_s3_key"] === "string" && first["image_s3_key"] !== "", "s3 key stored");
  assert.equal((first["raw_metadata"] as Record<string, unknown>)["saves"], 10);
});

test("duplicate source URLs are skipped (not saved twice)", async () => {
  const summary = await collectFromSource(
    fakeAdapter([{ sourceUrl: "https://x/1", imageUrl: fileUrl("a.png"), raw: {} }]),
    { db, storage },
  );
  assert.equal(summary.skippedDuplicate, 1);
  assert.equal(summary.saved, 0);
});

test("items without image URL are skipped cleanly", async () => {
  const summary = await collectFromSource(
    fakeAdapter([{ sourceUrl: "https://x/missing", imageUrl: "", raw: {} }]),
    { db, storage },
  );
  assert.equal(summary.skippedMissingImage, 1);
  assert.equal(summary.failed, 0);
});

test("missing image file keeps URL-only record (S3 backup failure fallback)", async () => {
  const summary = await collectFromSource(
    fakeAdapter([
      {
        sourceUrl: "https://x/broken",
        imageUrl: fileUrl("does-not-exist.png"),
        raw: { saves: 5 },
      },
    ]),
    { db, storage },
  );
  assert.equal(summary.saved, 1, "record is saved even when backup fails");
  const row = (await db.query("SELECT image_s3_key FROM raw_trend_images WHERE source_url=$1", ["https://x/broken"]))
    .rows[0] as { image_s3_key: string | null };
  assert.equal(row.image_s3_key, null);
});

test("instagram CSV adapter normalizes rows to RawSourceItems", async () => {
  const csvPath = path.join(imagesDir, "instagram.csv");
  writeFileSync(
    csvPath,
    `source_url,image_url,description,posted_at\nhttps://ig/1,${fileUrl("a.png")},"saree look",2026-08-01\nhttps://ig/2,${fileUrl("b.png")},"lehenga",2026-08-02`,
  );
  const adapter = new InstagramCsvAdapter(csvPath);
  const items = await adapter.fetchRaw();
  assert.equal(items.length, 2);
  assert.equal(items[0]!.sourceUrl, "https://ig/1");
  assert.equal(items[0]!.raw["description"], "saree look");
  assert.equal(items[0]!.collectedAt?.toISOString().slice(0, 10), "2026-08-01");
});

test("instagram CSV rejects missing required columns", async () => {
  const csvPath = path.join(imagesDir, "bad.csv");
  writeFileSync(csvPath, "description\nhello");
  const adapter = new InstagramCsvAdapter(csvPath);
  await assert.rejects(adapter.fetchRaw(), /source_url and image_url/);
});

test("parseCsv is used by instagram adapter end-to-end", async () => {
  const text = 'source_url,image_url\nhttps://ig/3,"' + fileUrl("a.png") + '"';
  const rows = parseCsv(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]![0], "https://ig/3");
});