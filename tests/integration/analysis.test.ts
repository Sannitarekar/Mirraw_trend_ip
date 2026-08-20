import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { openDatabase } from "../../src/db/index.ts";
import type { DbClient } from "../../src/db/types.ts";
import { LocalDiskStorage } from "../../src/storage/local-disk.ts";
import { AnalysisService } from "../../src/analysis/index.ts";
import { MockVisionProvider } from "../../src/vision/mock.ts";
import type { VisionProvider } from "../../src/vision/types.ts";

let db: DbClient;
let storage: LocalDiskStorage;
let imagesDir: string;

before(async () => {
  db = await openDatabase();
  imagesDir = mkdtempSync(path.join(tmpdir(), "tip-analysis-"));
  storage = new LocalDiskStorage(mkdtempSync(path.join(tmpdir(), "tip-store-")), "http://localhost:3000/files");
});

afterEach(async () => {
  await db.query("DELETE FROM trend_image_attributes");
  await db.query("DELETE FROM raw_trend_images");
});

after(async () => {
  await db.close();
});

async function seedPending(imageUrl: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO raw_trend_images (id, source, source_url, image_url) VALUES ($1,$2,$3,$4)`,
    [id, "instagram", `https://ig.example/${id}`, imageUrl],
  );
  return id;
}

async function writePng(): Promise<string> {
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 120, g: 60, b: 220 } },
  })
    .png()
    .toBuffer();
  const file = path.join(imagesDir, `${randomUUID()}.png`);
  writeFileSync(file, png);
  return `file:///${file.replaceAll("\\", "/")}`;
}

test("analyzePending extracts attributes and marks images analyzed", async () => {
  const url = await writePng();
  const id = await seedPending(url);

  const service = new AnalysisService(db, storage, new MockVisionProvider(), 1);
  const summary = await service.analyzePending();

  assert.equal(summary.analyzed, 1);
  const attrs = (await db.query("SELECT * FROM trend_image_attributes WHERE raw_image_id=$1", [id])).rows[0] as
    | Record<string, unknown>
    | undefined;
  assert.ok(attrs, "attributes row created");
  assert.ok(typeof attrs.garment_type === "string" && attrs.garment_type.length > 0);
  assert.ok(Array.isArray(attrs.color_palette));

  const status = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [id])).rows[0] as {
    status: string;
  };
  assert.equal(status.status, "analyzed");
});

test("analyzePending keeps records pending when nothing to do", async () => {
  const service = new AnalysisService(db, storage, new MockVisionProvider(), 1);
  const summary = await service.analyzePending();
  assert.equal(summary.pending, 0);
  assert.equal(summary.analyzed, 0);
});

test("a provider that always fails marks images analysis_failed (spec 12)", async () => {
  const failing: VisionProvider = {
    name: "always-fail",
    analyze: async () => {
      throw new Error("vision API down");
    },
  };
  const url = await writePng();
  const id = await seedPending(url);

  const service = new AnalysisService(db, storage, failing, 1);
  const summary = await service.analyzePending();
  assert.equal(summary.failed, 1);
  assert.equal(summary.analyzed, 0);

  const status = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [id])).rows[0] as {
    status: string;
  };
  assert.equal(status.status, "analysis_failed");
});

test("malformed provider output is treated as a failure, not silent success", async () => {
  const malformed: VisionProvider = {
    name: "malformed",
    analyze: async () => {
      // This should never happen through a real provider, but guard anyway.
      throw new Error("provider returned garbage");
    },
  };
  const url = await writePng();
  const id = await seedPending(url);

  const service = new AnalysisService(db, storage, malformed, 1);
  const summary = await service.analyzePending();
  assert.equal(summary.failed, 1);
  const status = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [id])).rows[0] as {
    status: string;
  };
  assert.equal(status.status, "analysis_failed");
});

test("records without a loadable image are skipped", async () => {
  const id = await seedPending("ftp://not-a-loadable-image.png");
  const service = new AnalysisService(db, storage, new MockVisionProvider(), 1);
  const summary = await service.analyzePending();
  assert.equal(summary.skippedNoImage, 1);
  assert.equal(summary.analyzed, 0);
  const status = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [id])).rows[0] as {
    status: string;
  };
  assert.equal(status.status, "pending");
});

test("batch size groups pending images correctly", async () => {
  const url = await writePng();
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) ids.push(await seedPending(url));

  const service = new AnalysisService(db, storage, new MockVisionProvider(), 1, 20);
  const summary = await service.analyzePending();
  assert.equal(summary.analyzed, 25);
  const analyzed = (await db.query(
    "SELECT count(*)::int AS n FROM raw_trend_images WHERE status='analyzed' AND id = ANY($1::uuid[])",
    [ids],
  )).rows[0] as { n: number };
  assert.equal(analyzed.n, 25);
});