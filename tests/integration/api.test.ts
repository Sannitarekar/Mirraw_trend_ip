import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { openDatabase } from "../../src/db/index.ts";
import type { DbClient } from "../../src/db/types.ts";
import { LocalDiskStorage } from "../../src/storage/local-disk.ts";
import { buildServer } from "../../src/api/server.ts";
import { queryTrendFeed, recordUsage } from "../../src/api/trends.ts";
import { getConfig } from "../../src/shared/config.ts";
import type { TrendAttributesLike } from "../../src/scoring/types.ts";

let db: DbClient;
let storage: LocalDiskStorage;
let server: FastifyInstance;

const FULL_ATTRS: TrendAttributesLike = {
  garment_type: "saree",
  color_palette: ["ivory", "gold"],
  pattern: "floral",
  fabric_texture: "silk",
  embellishment: "zari",
  silhouette: "A-line",
  occasion: "wedding",
  neckline: "round",
  sleeve_style: "sleeveless",
  trend_season: "summer 2026",
};

/** Seed a promoted feed entry; returns its trend_feed id. */
async function seedFeed(overrides: {
  score?: number;
  feedDate?: string;
  source?: string;
  garment?: string;
  occasion?: string;
  s3Key?: string | null;
  imageUrl?: string;
} = {}): Promise<string> {
  const rawId = randomUUID();
  const feedId = randomUUID();
  const s3Key = overrides.s3Key === undefined ? `pinterest/2026-08-19/${rawId}.png` : overrides.s3Key;
  const imageUrl = overrides.imageUrl ?? `https://img.example/${rawId}.jpg`;
  await db.query(
    `INSERT INTO raw_trend_images (id, source, source_url, image_url, image_s3_key, raw_metadata, collected_at, status)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'scored')`,
    [
      rawId,
      overrides.source ?? "pinterest",
      `https://src.example/${rawId}`,
      imageUrl,
      s3Key,
      JSON.stringify({}),
      new Date("2026-08-19T12:00:00Z"),
    ],
  );
  const attrs = { ...FULL_ATTRS, ...(overrides.garment ? { garment_type: overrides.garment } : {}), ...(overrides.occasion ? { occasion: overrides.occasion } : {}) };
  await db.query(
    `INSERT INTO trend_image_attributes (id, raw_image_id, garment_type, color_palette, pattern,
        fabric_texture, embellishment, silhouette, occasion, neckline, sleeve_style, trend_season, phash)
     VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      randomUUID(),
      rawId,
      attrs.garment_type,
      attrs.color_palette,
      attrs.pattern,
      attrs.fabric_texture,
      attrs.embellishment,
      attrs.silhouette,
      attrs.occasion,
      attrs.neckline,
      attrs.sleeve_style,
      attrs.trend_season,
      null,
    ],
  );
  await db.query(
    `INSERT INTO trend_feed (id, raw_image_id, trend_score, feed_date, rank)
     VALUES ($1,$2,$3,$4::date,$5)`,
    [feedId, rawId, overrides.score ?? 80, overrides.feedDate ?? "2026-08-19", 1],
  );
  return feedId;
}

before(async () => {
  db = await openDatabase();
  storage = new LocalDiskStorage(`${process.cwd()}/.data/test-storage`, "http://localhost:3000/files");
  await storage.put("pinterest/2026-08-19/sample.png", new Uint8Array([1, 2, 3]), "image/png");
  server = await buildServer({ db, storage });
});

after(async () => {
  await server.close();
  await db.close();
});

test("GET /feed returns promoted images with resolved image_s3_url", async () => {
  const feedId = await seedFeed({ s3Key: "pinterest/2026-08-19/sample.png" });
  const res = await server.inject({ method: "GET", url: "/api/v1/trends/feed?date_from=2026-08-10&date_to=2026-08-20" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.total, 1);
  assert.equal(body.has_more, false);
  assert.equal(body.images[0].id, feedId);
  assert.equal(body.images[0].image_s3_url, "http://localhost:3000/files/pinterest/2026-08-19/sample.png");
  assert.equal(body.images[0].attributes.garment_type, "saree");
  assert.ok(Array.isArray(body.images[0].attributes.color_palette));
  assert.equal(body.images[0].trend_score, 80);
  assert.equal(body.images[0].source, "pinterest");
  assert.ok(body.images[0].collected_at);
});

test("GET /feed enforces min_score, date range, filters and pagination", async () => {
  await seedFeed({ score: 90, feedDate: "2026-08-19", garment: "lehenga", occasion: "party" });
  await seedFeed({ score: 50, feedDate: "2026-08-18", garment: "kurta", occasion: "casual" });

  // min_score excludes the 50.
  const res = await server.inject({
    method: "GET",
    url: "/api/v1/trends/feed?date_from=2026-08-01&date_to=2026-08-31&min_score=60",
  });
  const body = res.json();
  assert.equal(body.total, 2);
  assert.ok(body.images.every((i: { trend_score: number }) => i.trend_score >= 60));

  // date_from cuts the 08-18 entry.
  const res2 = await server.inject({
    method: "GET",
    url: "/api/v1/trends/feed?date_from=2026-08-19&date_to=2026-08-31",
  });
  const body2 = res2.json();
  assert.equal(body2.total, 2);

  // garment filter.
  const res3 = await server.inject({
    method: "GET",
    url: "/api/v1/trends/feed?date_from=2026-08-01&date_to=2026-08-31&garment_type=kurta",
  });
  const body3 = res3.json();
  assert.equal(body3.total, 1);
  assert.equal(body3.images[0].attributes.garment_type, "kurta");

  // pagination: limit 1 page 1 -> has_more.
  const res4 = await server.inject({
    method: "GET",
    url: "/api/v1/trends/feed?date_from=2026-08-01&date_to=2026-08-31&limit=1&page=1",
  });
  const body4 = res4.json();
  assert.equal(body4.images.length, 1);
  assert.equal(body4.has_more, true);
});

test("GET /feed rejects invalid query params", async () => {
  const res = await server.inject({ method: "GET", url: "/api/v1/trends/feed?limit=abc" });
  assert.equal(res.statusCode, 400);
});

test("POST /used records a use and 404s on unknown feed id", async () => {
  const feedId = await seedFeed();
  const res = await server.inject({ method: "POST", url: `/api/v1/trends/${feedId}/used` });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().usage_count, 1);

  const miss = await server.inject({
    method: "POST",
    url: "/api/v1/trends/00000000-0000-0000-0000-000000000000/used",
  });
  assert.equal(miss.statusCode, 404);
});

test("POST /used rejects a 4th use in the same month", async () => {
  const feedId = await seedFeed();
  const { recordUsage: record } = await import("../../src/api/trends.ts");
  for (let i = 0; i < 3; i++) {
    const r = await record(db, feedId, getConfig());
    assert.equal(r.ok, true);
  }
  const fourth = await record(db, feedId, getConfig());
  assert.ok(!fourth.ok);
  assert.equal(fourth.status, 429);
});

test("concurrent /used calls never exceed the 3-use cap", async () => {
  const feedId = await seedFeed();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => recordUsage(db, feedId, getConfig())),
  );
  const okCount = results.filter((r) => r.ok).length;
  const rejectedCount = results.filter((r) => !r.ok).length;
  assert.equal(okCount, 3);
  assert.equal(rejectedCount, 3);

  const month = new Date().toISOString().slice(0, 7);
  const rawId = (await db.query("SELECT raw_image_id FROM trend_feed WHERE id=$1", [feedId])).rows[0]
    ?.raw_image_id as string;
  const usage = (await db.query("SELECT count(*)::int AS n FROM trend_image_usage WHERE raw_image_id=$1 AND usage_month=$2", [
    rawId,
    month,
  ])).rows[0] as { n: number };
  assert.equal(usage.n, 3);
});

test("queryTrendFeed falls back to image_url when no storage key exists", async () => {
  const feedId = await seedFeed({ s3Key: null, imageUrl: "https://cdn.example/photo.jpg" });
  const res = await server.inject({
    method: "GET",
    url: "/api/v1/trends/feed?date_from=2026-08-10&date_to=2026-08-20",
  });
  const body = res.json();
  const match = body.images.find((i: { id: string }) => i.id === feedId);
  assert.equal(match.image_s3_url, "https://cdn.example/photo.jpg");
});

test("/files serves stored objects", async () => {
  const res = await server.inject({ method: "GET", url: "/files/pinterest/2026-08-19/sample.png" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.deepEqual([...res.rawPayload], [1, 2, 3]);
});

test("GET /health reports ok", async () => {
  const res = await server.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});