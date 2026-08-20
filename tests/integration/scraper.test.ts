import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BrowserScraper } from "../../src/collectors/scraper-framework/browser.ts";
import { HtmlScraperAdapter, getSiteConfigs } from "../../src/collectors/scraper-framework/html-scraper.ts";
import { ScraperBlockedError } from "../../src/collectors/common/types.ts";

const browser = new BrowserScraper();
let browserOpen = false;

test("BrowserScraper loads a page and returns raw HTML", async () => {
  browserOpen = true;
  const vogue = getSiteConfigs().find((c) => c.source === "vogue")!;
  const url = `file:///${path.join(process.cwd(), "sample-data/html/vogue.html").replaceAll("\\", "/")}`;
  const result = await browser.scrape(url, { readySelector: ".grid-article" });
  assert.match(result.html, /grid-article/);
  assert.match(result.title, /vogue/i);
});

test("HtmlScraperAdapter extracts cards from a fixture page in fixture mode", async () => {
  const vogue = getSiteConfigs().find((c) => c.source === "vogue")!;
  const adapter = new HtmlScraperAdapter(vogue, browser, "fixture");
  const items = await adapter.fetchRaw();
  assert.ok(items.length > 0, "fixture page yields cards");
  const first = items[0]!;
  assert.ok(first.imageUrl.startsWith("file://"), "image URLs extracted from fixture");
  assert.ok(first.sourceUrl.startsWith("https://"), "article links extracted");
  assert.ok(first.raw["title"], "title preserved in raw payload");

  const snapshot = await adapter.fetchRawHtml();
  assert.ok(snapshot, "raw HTML snapshot available for S3 backup");
  assert.match(snapshot.html, /grid-article/);
});

test("all four site configs scrape their fixture pages", async () => {
  for (const config of getSiteConfigs()) {
    const adapter = new HtmlScraperAdapter(config, browser, "fixture");
    const items = await adapter.fetchRaw();
    assert.ok(items.length > 0, `${config.source} yields items`);
  }
});

test("anti-bot pages raise ScraperBlockedError", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tip-block-"));
  const blockedFile = path.join(dir, "blocked.html");
  writeFileSync(
    blockedFile,
    '<html><head><title>Verify you are human</title></head><body>captcha required to continue</body></html>',
  );
  const url = `file:///${blockedFile.replaceAll("\\", "/")}`;
  await assert.rejects(browser.scrape(url), ScraperBlockedError);
});

test("browser close is idempotent", async () => {
  await browser.close();
  browserOpen = false;
  await browser.close(); // second close should not throw
});