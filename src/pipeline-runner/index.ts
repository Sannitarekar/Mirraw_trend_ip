import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../shared/config.ts";
import { getLogger } from "../shared/logger.ts";
import { openDatabase } from "../db/index.ts";
import { createStorage } from "../storage/index.ts";
import { collectFromSource } from "../collectors/common/collect.ts";
import { InstagramCsvAdapter } from "../collectors/instagram-csv/index.ts";
import { PinterestAdapter } from "../collectors/pinterest/index.ts";
import { BrowserScraper } from "../collectors/scraper-framework/browser.ts";
import { HtmlScraperAdapter, getSiteConfigs } from "../collectors/scraper-framework/html-scraper.ts";
import { AnalysisService } from "../analysis/index.ts";
import { createVisionProvider } from "../vision/index.ts";
import { ScoringService } from "../scoring/service.ts";
import { createSlackNotifier } from "../slack/index.ts";
import type { DbClient } from "../db/types.ts";
import type { ObjectStorage } from "../storage/types.ts";
import type { SourceAdapter } from "../collectors/common/types.ts";

const SAMPLE_DATA_DIR = fileURLToPath(new URL("../../sample-data", import.meta.url));
const INSTAGRAM_CSV = path.join(SAMPLE_DATA_DIR, "instagram", "instagram-looks.csv");

/**
 * Local equivalent of the three n8n workflows (spec section 11).
 *
 *   node src/pipeline-runner/index.ts collect   -> Workflow 1 (Collection)
 *   node src/pipeline-runner/index.ts analyze   -> Workflow 2 (Analysis)
 *   node src/pipeline-runner/index.ts score     -> Workflow 3 (Scoring & Promotion)
 *   node src/pipeline-runner/index.ts all       -> the three in sequence
 */
export async function runPipeline(step: string): Promise<void> {
  const logger = getLogger();
  const db = await openDatabase();
  const storage = createStorage();

  try {
    switch (step) {
      case "collect": {
        await collectStep(db, storage);
        break;
      }
      case "analyze": {
        const service = new AnalysisService(db, storage, createVisionProvider());
        const summary = await service.analyzePending();
        logger.info("pipeline: analyze complete", { ...summary });
        break;
      }
      case "score": {
        const service = new ScoringService(db, createSlackNotifier());
        const summary = await service.scoreAndPromote();
        logger.info("pipeline: score & promote complete", { ...summary });
        break;
      }
      case "all": {
        await collectStep(db, storage);
        const analysis = new AnalysisService(db, storage, createVisionProvider());
        const a = await analysis.analyzePending();
        logger.info("pipeline: analyze complete", { ...a });
        const scoring = new ScoringService(db, createSlackNotifier());
        const s = await scoring.scoreAndPromote();
        logger.info("pipeline: score & promote complete", { ...s });
        break;
      }
      default:
        throw new Error(`unknown pipeline step '${step}' (expected collect|analyze|score|all)`);
    }
  } finally {
    await db.close();
  }
}

async function collectStep(db: DbClient, storage: ObjectStorage): Promise<void> {
  const logger = getLogger();
  const browser = new BrowserScraper();
  const adapters = await buildCollectors(browser);

  try {
    for (const adapter of adapters) {
      try {
        const summary = await collectFromSource(adapter, { db, storage });
        logger.info("pipeline: collect done", { ...summary });
      } catch (error) {
        // Spec 12: a collector failure alerts Slack and skips the source for the
        // day; it never aborts the rest of the collection run.
        logger.error("pipeline: collector failed", { source: adapter.source, error: (error as Error).message });
      }
    }
  } finally {
    // Close the shared Chromium so the process can exit (an orphaned browser
    // keeps the stdio pipe open and the run never terminates).
    await browser.close();
  }
}

/** Instantiates every source adapter for this run's mode. */
async function buildCollectors(browser: BrowserScraper): Promise<SourceAdapter[]> {
  const cfg = getConfig();
  const adapters: SourceAdapter[] = [];

  if (existsSync(INSTAGRAM_CSV)) {
    adapters.push(new InstagramCsvAdapter(INSTAGRAM_CSV));
  } else {
    getLogger().warn("pipeline: instagram CSV not found, skipping", { path: INSTAGRAM_CSV });
  }

  adapters.push(new PinterestAdapter());

  for (const site of getSiteConfigs()) {
    adapters.push(new HtmlScraperAdapter(site, browser, cfg.SCRAPER_MODE === "live" ? "live" : "fixture"));
  }

  return adapters;
}

// CLI entrypoint (only when run directly, not when imported by tests).
const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryUrl) {
  const step = process.argv[2] ?? "all";
  runPipeline(step).catch((error) => {
    getLogger().error("pipeline: fatal", { error: (error as Error).message });
    process.exit(1);
  });
}