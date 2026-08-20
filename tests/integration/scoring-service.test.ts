import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../src/db/index.ts";
import type { DbClient } from "../../src/db/types.ts";
import { getConfig } from "../../src/shared/config.ts";
import { ScoringService } from "../../src/scoring/service.ts";
import type { TrendAttributesLike } from "../../src/scoring/types.ts";
import { MockSlackNotifier } from "../../src/slack/index.ts";

let db: DbClient;

before(async () => {
  db = await openDatabase();
});

after(async () => {
  await db.close();
});

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

interface SeedOptions {
  saveCount?: number;
  source?: string;
  collectedAt?: Date;
  phash?: string | null;
  attributes?: Partial<TrendAttributesLike>;
}

async function seedAnalyzed(opts: SeedOptions = {}): Promise<string> {
  const id = randomUUID();
  const metadata = JSON.stringify({ pin_metrics: { save_count: opts.saveCount ?? 0 } });
  await db.query(
    `INSERT INTO raw_trend_images (id, source, source_url, image_url, raw_metadata, collected_at, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'analyzed')`,
    [id, opts.source ?? "vogue", `https://src.example/${id}`, `https://img.example/${id}.jpg`, metadata, opts.collectedAt ?? new Date()],
  );
  const attrs = { ...FULL_ATTRS, ...opts.attributes };
  await db.query(
    `INSERT INTO trend_image_attributes (id, raw_image_id, garment_type, color_palette, pattern,
        fabric_texture, embellishment, silhouette, occasion, neckline, sleeve_style, trend_season, phash)
     VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      randomUUID(),
      id,
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
      opts.phash ?? null,
    ],
  );
  return id;
}

function configWith(overrides: Partial<ReturnType<typeof getConfig>>) {
  return { ...getConfig(), ...overrides };
}

test("scoreAndPromote scores, marks status and promotes to the feed", async () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const id = await seedAnalyzed({ saveCount: 5000, phash: "a".repeat(16), collectedAt: now });
  const service = new ScoringService(db, new MockSlackNotifier(), configWith({ TREND_FEED_PROMOTE_LIMIT: 200 }));
  const summary = await service.scoreAndPromote(now);

  assert.equal(summary.scored, 1);
  assert.equal(summary.discarded, 0);
  assert.equal(summary.deduplicated, 0);
  assert.equal(summary.promoted, 1);
  assert.equal(summary.feedDate, "2026-08-19");

  const attrs = (await db.query("SELECT trend_score FROM trend_image_attributes WHERE raw_image_id=$1", [id])).rows[0] as {
    trend_score: number;
  };
  assert.equal(attrs.trend_score, 100); // saves 40 + recency 30 + authority 20 + completeness 10

  const status = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [id])).rows[0] as { status: string };
  assert.equal(status.status, "scored");

  const feed = (await db.query("SELECT * FROM trend_feed WHERE raw_image_id=$1", [id])).rows[0] as {
    rank: number;
    feed_date: Date | string;
  } | undefined;
  assert.ok(feed, "feed row created");
  assert.equal(feed.rank, 1);
  const feedDay = feed.feed_date instanceof Date ? feed.feed_date.toISOString().slice(0, 10) : String(feed.feed_date).slice(0, 10);
  assert.equal(feedDay, "2026-08-19");
});

test("low-scoring images are discarded, not promoted", async () => {
  // saveCount 0, 10 days old, scraper source, 4 unknowns -> total 10 (< 20).
  const id = await seedAnalyzed({
    saveCount: 0,
    source: "nykaa",
    collectedAt: new Date("2026-08-01T12:00:00Z"),
    attributes: {
      garment_type: "unknown",
      pattern: "unknown",
      fabric_texture: "unknown",
      silhouette: "unknown",
    },
  });
  const service = new ScoringService(db, new MockSlackNotifier());
  const summary = await service.scoreAndPromote(new Date("2026-08-19T12:00:00Z"));

  assert.equal(summary.discarded, 1);
  const status = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [id])).rows[0] as { status: string };
  assert.equal(status.status, "discarded");
  const feed = (await db.query("SELECT 1 FROM trend_feed WHERE raw_image_id=$1", [id])).rows[0];
  assert.equal(feed, undefined);
});

test("near-duplicate images keep only the higher-scored one", async () => {
  const now = new Date("2026-08-20T12:00:00Z");
  const dupPhash = "0123456789abcdef";
  const low = await seedAnalyzed({ saveCount: 1000, phash: dupPhash, attributes: { pattern: "unknown", occasion: "unknown", neckline: "unknown" }, collectedAt: now });
  const high = await seedAnalyzed({ saveCount: 5000, phash: dupPhash, collectedAt: now });
  const service = new ScoringService(db, new MockSlackNotifier());
  const summary = await service.scoreAndPromote(now);

  assert.equal(summary.deduplicated, 1);
  assert.equal(summary.promoted, 1);
  const lowStatus = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [low])).rows[0] as { status: string };
  const highStatus = (await db.query("SELECT status FROM raw_trend_images WHERE id=$1", [high])).rows[0] as { status: string };
  assert.equal(lowStatus.status, "discarded");
  assert.equal(highStatus.status, "scored");
  const feed = (await db.query("SELECT raw_image_id FROM trend_feed WHERE feed_date='2026-08-20'")).rows as { raw_image_id: string }[];
  assert.deepEqual(feed.map((f) => f.raw_image_id), [high]);
});

test("promotion is capped at TREND_FEED_PROMOTE_LIMIT", async () => {
  const now = new Date("2026-08-21T12:00:00Z");
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    // phash null: distinct images, no accidental dedup in this test.
    ids.push(await seedAnalyzed({ saveCount: 5000, collectedAt: now }));
  }
  const service = new ScoringService(db, new MockSlackNotifier(), configWith({ TREND_FEED_PROMOTE_LIMIT: 3 }));
  const summary = await service.scoreAndPromote(now);

  assert.equal(summary.promoted, 3);
  const feedCount = (await db.query("SELECT count(*)::int AS n FROM trend_feed WHERE feed_date='2026-08-21'")).rows[0] as { n: number };
  assert.equal(feedCount.n, 3);
  void ids;
});

test("re-running promotion is idempotent (no duplicate feed rows)", async () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const id = await seedAnalyzed({ saveCount: 5000, phash: "b".repeat(16), collectedAt: now });
  const service = new ScoringService(db, new MockSlackNotifier(), configWith({ TREND_FEED_PROMOTE_LIMIT: 200 }));
  await service.scoreAndPromote(now);
  await service.scoreAndPromote(now); // second run has nothing analyzed

  const feed = (await db.query("SELECT count(*)::int AS n FROM trend_feed WHERE raw_image_id=$1", [id])).rows[0] as { n: number };
  assert.equal(feed.n, 1);
});