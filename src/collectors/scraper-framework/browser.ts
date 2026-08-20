import { chromium, type Browser, type Page } from "playwright";
import { retryWithBackoff } from "../../collectors/common/retry.ts";
import { ScraperBlockedError } from "../../collectors/common/types.ts";

export interface ScrapeResult<T = unknown> {
  url: string;
  html: string;
  title: string;
  bodyText: string;
  /** Data returned by the site-specific extract() callback. */
  extracted: T | null;
}

const BLOCK_INDICATORS = [
  "captcha",
  "attention required",
  "are you a robot",
  "verify you are human",
  "access denied",
  "pardon our interruption",
  "unusual traffic",
];

export interface ScrapeOptions<T> {
  readySelector?: string;
  timeoutMs?: number;
  /** Site-specific DOM extraction, run inside the live page. */
  extract?: (page: Page) => Promise<T>;
}

/**
 * Shared headless-Chromium wrapper (spec 6.2: Playwright headless Chromium).
 *
 * Responsibilities:
 *  - launch/reuse a browser for the whole run
 *  - navigate with timeout and exponential-backoff retries
 *  - detect anti-bot pages (CAPTCHA / "attention required") and surface them
 *    as ScraperBlockedError so the orchestrator can alert Slack and skip the
 *    source for the day (spec 12)
 *  - expose the raw HTML for the S3 audit snapshot (spec 6.2)
 */
export class BrowserScraper {
  private browser: Browser | null = null;
  private readonly headless: boolean;

  constructor(headless = true) {
    this.headless = headless;
  }

  async scrape<T = unknown>(
    url: string,
    options: ScrapeOptions<T> = {},
  ): Promise<ScrapeResult<T>> {
    const page = await this.openPage(url, options.timeoutMs ?? 30_000);

    // Wait for content that indicates the page actually rendered (JS pages).
    if (options.readySelector) {
      try {
        await page.waitForSelector(options.readySelector, { timeout: options.timeoutMs ?? 15_000 });
      } catch {
        await page.close();
        throw new Error(`ready selector not found after load: ${options.readySelector}`);
      }
    }

    const [html, title, bodyText, extracted] = await Promise.all([
      page.content(),
      page.title().catch(() => ""),
      page.evaluate(() => document.body?.innerText ?? "").catch(() => ""),
      options.extract ? options.extract(page) : Promise.resolve(null),
    ]);
    await page.close();

    this.assertNotBlocked(title, bodyText, url);
    return { url, html, title, bodyText, extracted };
  }

  private async openPage(url: string, timeoutMs: number): Promise<Page> {
    const context = await this.getContext();
    return retryWithBackoff(
      async () => {
        const page = await context.newPage();
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        } catch (error) {
          await page.close();
          throw error;
        }
        return page;
      },
      {
        attempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 10000,
        shouldRetry: () => true,
      },
    );
  }

  private async getContext() {
    this.browser = this.browser ?? (await chromium.launch({ headless: this.headless }));
    return this.browser.newContext({ userAgent: "Mozilla/5.0 (compatible; TrendIntelligenceBot/1.0)" });
  }

  private assertNotBlocked(title: string, bodyText: string, url: string): void {
    const haystack = `${title} ${bodyText}`.toLowerCase();
    const hit = BLOCK_INDICATORS.find((phrase) => haystack.includes(phrase));
    if (hit) {
      throw new ScraperBlockedError(url, `anti-bot page detected ("${hit}")`);
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}