/**
 * Source adapter contract.
 *
 * Every data source (Pinterest API, Vogue scraper, Instagram CSV, ...)
 * implements this interface. The adapter is responsible for:
 *   fetch()   - talk to the external source (handle pagination, rate limits)
 *   normalize - turn raw responses into the shared RawSourceItem shape
 *
 * The shared collectFromSource() runner then performs the storage/database
 * work (dedupe, image download, S3 backup, insert as 'pending'), so sources
 * stay independent and the pipeline logic lives in exactly one place.
 */
export interface RawSourceItem {
  /** Original URL of the page / pin / post (dedup key). */
  sourceUrl: string;
  /** Direct URL of the image. */
  imageUrl: string;
  /** The full raw API/scraper payload, preserved for audit. */
  raw: Record<string, unknown>;
  /** Overrides the collection timestamp (e.g. backfill). */
  collectedAt?: Date;
}

export interface SourceAdapter {
  /** Stable source identifier, e.g. "pinterest", "vogue", "instagram". */
  readonly source: string;
  /** Fetch and normalize raw items. Fails fast per-source. */
  fetchRaw(): Promise<RawSourceItem[]>;
  /**
   * Optional raw page snapshot for audit (spec 6.2: store raw HTML in S3
   * alongside extracted image URLs). The collector runner stores it.
   */
  fetchRawHtml?(): Promise<{ url: string; html: string } | null>;
}

/** Thrown when a scraper is blocked / served a CAPTCHA (spec 12). */
export class ScraperBlockedError extends Error {
  constructor(source: string, message: string) {
    super(`[${source}] scraper blocked: ${message}`);
    this.name = "ScraperBlockedError";
  }
}

export interface CollectionSummary {
  source: string;
  fetched: number;
  saved: number;
  skippedDuplicate: number;
  skippedMissingImage: number;
  failed: number;
}

export class SourceCollectionError extends Error {
  readonly cause: unknown;

  constructor(source: string, message: string, cause?: unknown) {
    super(`[${source}] ${message}`);
    this.name = "SourceCollectionError";
    this.cause = cause;
  }
}