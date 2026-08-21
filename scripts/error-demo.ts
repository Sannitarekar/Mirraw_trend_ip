import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db/index.ts";
import { createStorage } from "../src/storage/index.ts";
import { collectFromSource } from "../src/collectors/common/collect.ts";
import { getLogger } from "../src/shared/logger.ts";
import { InstagramCsvAdapter } from "../src/collectors/instagram-csv/index.ts";
import { BrowserScraper } from "../src/collectors/scraper-framework/browser.ts";
import { HtmlScraperAdapter, getSiteConfigs } from "../src/collectors/scraper-framework/html-scraper.ts";
import type { RawSourceItem, SourceAdapter } from "../src/collectors/common/types.ts";

/**
 * Controlled demonstration of per-source failure isolation (spec 12):
 * Pinterest genuinely throws (connection refused) while the other sources
 * collect normally. Run as a child process by scripts/capture-error-figure.ts;
 * expects NODE_ENV=test (in-memory database) and a throwaway LOCAL_STORAGE_DIR.
 */

class FailingPinterestAdapter implements SourceAdapter {
  readonly source = "pinterest";
  async fetchRaw(): Promise<RawSourceItem[]> {
    // Simulates the real API being unreachable — no data is fabricated.
    throw new Error("connect ECONNREFUSED api.pinterest.com:443");
  }
}

const root = fileURLToPath(new URL("..", import.meta.url));
const db = await openDatabase();
const storage = createStorage();
const browser = new BrowserScraper();
const logger = getLogger();

const adapters: SourceAdapter[] = [
  new InstagramCsvAdapter(path.join(root, "sample-data", "instagram", "instagram-looks.csv")),
  new FailingPinterestAdapter(),
  new HtmlScraperAdapter(getSiteConfigs()[0]!, browser, "fixture"),
];

for (const adapter of adapters) {
  try {
    const summary = await collectFromSource(adapter, { db, storage });
    logger.info("pipeline: collect done", { ...summary });
  } catch (error) {
    // Spec 12: a failing source never aborts the run.
    logger.error("pipeline: collector failed", { source: adapter.source, error: (error as Error).message });
  }
}

await browser.close();
await db.close();