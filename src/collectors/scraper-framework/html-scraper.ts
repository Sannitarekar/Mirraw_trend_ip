import { fileURLToPath } from "node:url";
import path from "node:path";
import { getConfig } from "../../shared/config.ts";
import { getLogger } from "../../shared/logger.ts";
import type { RawSourceItem, SourceAdapter } from "../common/types.ts";
import type { BrowserScraper, ScrapeResult } from "./browser.ts";

const SAMPLE_HTML_DIR = fileURLToPath(new URL("../../../sample-data/html", import.meta.url));

export interface SiteCard {
  link: string | null;
  image: string | null;
  title: string | null;
  meta: string | null;
}

export interface HtmlSiteConfig {
  /** Stable source id, e.g. "vogue". */
  source: string;
  /** Real site URLs used in SCRAPER_MODE=live. */
  liveUrls: string[];
  /** Fixture HTML file name inside sample-data/html (SCRAPER_MODE=fixture). */
  fixtureFile: string;
  /** Selector that must appear for the grid to be considered rendered. */
  readySelector: string;
  selectors: {
    cards: string; // selector for each card element
    link: string; // relative selector for the anchor
    image: string; // relative selector for the image
    title: string; // relative selector for the title
    meta: string; // relative selector for date/price
  };
}

/**
 * Shared adapter for the four Playwright scrapers.
 *
 * Each site is a thin config (source name, URLs, CSS selectors); the loading,
 * extraction, block detection, and raw-HTML snapshot logic lives here once.
 * In fixture mode it loads the local demo HTML files; in live mode it hits
 * the real sites with the same selectors.
 */
export class HtmlScraperAdapter implements SourceAdapter {
  readonly source: string;
  private lastSnapshot: { url: string; html: string } | null = null;
  private readonly config: HtmlSiteConfig;
  private readonly browser: BrowserScraper;
  private readonly mode: "fixture" | "live";

  constructor(config: HtmlSiteConfig, browser: BrowserScraper, mode: "fixture" | "live") {
    this.source = config.source;
    this.config = config;
    this.browser = browser;
    this.mode = mode;
  }

  async fetchRaw(): Promise<RawSourceItem[]> {
    const logger = getLogger();
    const urls = this.targetUrls();
    const items: RawSourceItem[] = [];

    for (const url of urls) {
      const result: ScrapeResult<SiteCard[]> = await this.browser.scrape(url, {
        readySelector: this.config.readySelector,
        extract: (page) => this.extractCards(page),
      });
      this.lastSnapshot = { url, html: result.html };
      logger.info(`${this.source}: scraped page`, { url, cards: result.extracted?.length ?? 0 });

      for (const card of result.extracted ?? []) {
        const item = this.normalize(card, url);
        if (item) items.push(item);
      }
    }
    return items;
  }

  async fetchRawHtml(): Promise<{ url: string; html: string } | null> {
    return this.lastSnapshot;
  }

  private targetUrls(): string[] {
    if (this.mode === "live") return this.config.liveUrls;
    const fixturePath = path.join(SAMPLE_HTML_DIR, this.config.fixtureFile);
    return [`file:///${fixturePath.replaceAll("\\", "/")}`];
  }

  private extractCards(page: import("playwright").Page): Promise<SiteCard[]> {
    return page.$$eval(
      this.config.selectors.cards,
      (cards, sel) =>
        cards.map((card) => {
          const link = card.querySelector<HTMLAnchorElement>(sel.link)?.href ?? null;
          const img = card.querySelector<HTMLImageElement>(sel.image);
          const image = img?.src || img?.getAttribute("data-src") || null;
          return {
            link,
            image,
            title: card.querySelector(sel.title)?.textContent?.trim() ?? null,
            meta: card.querySelector(sel.meta)?.textContent?.trim() ?? null,
          };
        }),
      this.config.selectors,
    );
  }

  private normalize(card: SiteCard, pageUrl: string): RawSourceItem | null {
    if (!card.image || !card.link) return null; // cards without an image are skipped
    return {
      sourceUrl: card.link,
      imageUrl: card.image,
      raw: {
        title: card.title,
        meta: card.meta,
        page_url: pageUrl,
        scraper: this.config.source,
      },
    };
  }
}

/** Builds the four site configs used by the pipeline runner. */
export function getSiteConfigs(): HtmlSiteConfig[] {
  const cfg = getConfig();
  const vogue: HtmlSiteConfig = {
    source: "vogue",
    liveUrls: ["https://www.vogue.in/fashion/celebrity-style"],
    fixtureFile: "vogue.html",
    readySelector: ".grid-article",
    selectors: {
      cards: ".grid-article",
      link: "a.article-link",
      image: "img.article-image",
      title: "h3.article-title",
      meta: "span.article-date",
    },
  };
  const filmfare: HtmlSiteConfig = {
    source: "filmfare",
    liveUrls: ["https://www.filmfare.com/style/celebrity-looks"],
    fixtureFile: "filmfare.html",
    readySelector: ".gallery-item",
    selectors: {
      cards: ".gallery-item",
      link: "a.gallery-link",
      image: "img.gallery-img",
      title: "h3.gallery-title",
      meta: "span.gallery-date",
    },
  };
  const fdciLakme: HtmlSiteConfig = {
    source: "fdci-lakme",
    liveUrls: ["https://www.fdci.org/lakme-fashion-week"],
    fixtureFile: "fdci.html",
    readySelector: ".runway-card",
    selectors: {
      cards: ".runway-card",
      link: "a.runway-link",
      image: "img.runway-img",
      title: "h3.runway-label",
      meta: "span.runway-date",
    },
  };
  const nykaaMyntra: HtmlSiteConfig = {
    source: "nykaa-myntra",
    liveUrls: ["https://www.myntra.com/ethnic-wear"],
    fixtureFile: "nykaa.html",
    readySelector: ".product-card",
    selectors: {
      cards: ".product-card",
      link: "a.product-link",
      image: "img.product-img",
      title: "h3.product-name",
      meta: "span.product-price",
    },
  };
  return [vogue, filmfare, fdciLakme, nykaaMyntra];
}

export type { ScrapeResult } from "./browser.ts";