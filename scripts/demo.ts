import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/index.ts";
import { createStorage } from "../src/storage/index.ts";
import { getConfig } from "../src/shared/config.ts";
import { getLogger } from "../src/shared/logger.ts";
import { collectFromSource } from "../src/collectors/common/collect.ts";
import { InstagramCsvAdapter } from "../src/collectors/instagram-csv/index.ts";
import { PinterestAdapter } from "../src/collectors/pinterest/index.ts";
import { BrowserScraper } from "../src/collectors/scraper-framework/browser.ts";
import { HtmlScraperAdapter, getSiteConfigs } from "../src/collectors/scraper-framework/html-scraper.ts";
import { AnalysisService } from "../src/analysis/index.ts";
import { createVisionProvider } from "../src/vision/index.ts";
import { ScoringService } from "../src/scoring/service.ts";
import { createSlackNotifier } from "../src/slack/index.ts";
import { queryTrendFeed } from "../src/api/trends.ts";

/**
 * End-to-end demo: resets the demo database, runs the full pipeline
 * (collect -> analyze -> score & promote), then shows the promoted feed.
 *
 *   npm run demo
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const cfg = getConfig();
const logger = getLogger();

// Fresh, reproducible demo.
rmSync(path.join(root, ".data"), { recursive: true, force: true });

const db = await openDatabase();
const storage = createStorage();
const instagramCsv = path.join(root, "sample-data", "instagram", "instagram-looks.csv");
const browser = new BrowserScraper();

try {
  logger.info("demo: collecting from mock sources (Instagram CSV, Pinterest, fixture scrapers)");
  const adapters = [
    new InstagramCsvAdapter(instagramCsv),
    new PinterestAdapter(),
    ...getSiteConfigs().map((site) => new HtmlScraperAdapter(site, browser, "fixture")),
  ];
  for (const adapter of adapters) {
    const summary = await collectFromSource(adapter, { db, storage });
    logger.info("demo: collection done", { ...summary });
  }

  logger.info("demo: analyzing images (mock vision provider)");
  const analysis = new AnalysisService(db, storage, createVisionProvider());
  const a = await analysis.analyzePending();
  logger.info("demo: analysis done", { ...a });

  logger.info("demo: scoring, deduplicating and promoting");
  const scoring = new ScoringService(db, createSlackNotifier());
  const s = await scoring.scoreAndPromote();
  logger.info("demo: promotion done", { ...s });

  const feed = await queryTrendFeed(db, cfg, { dateFrom: "2026-01-01", minScore: 0 });
  console.log("\n=== TREND FEED (top entries) ===");
  for (const image of feed.images.slice(0, 10)) {
    console.log(
      `rank #${feed.images.indexOf(image) + 1}  score=${image.trend_score}  ${image.attributes.garment_type}  ` +
        `(${image.attributes.occasion})  ${image.source}`,
    );
  }
  console.log(`\n${feed.images.length} images in the promoted feed.`);

  const counts = await db.query(
    "SELECT status, count(*)::int AS n FROM raw_trend_images GROUP BY status ORDER BY status",
  );
  console.log("\n=== raw_trend_images by status ===");
  for (const row of counts.rows) {
    console.log(`  ${row.status}: ${row.n}`);
  }

  console.log("\nDemo complete. Start the API with:  npm run api   then GET /api/v1/trends/feed");
} finally {
  await browser.close();
  await db.close();
}