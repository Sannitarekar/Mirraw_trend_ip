import { getConfig } from "../../shared/config.ts";
import { getLogger } from "../../shared/logger.ts";
import { HttpError, retryWithBackoff } from "../common/retry.ts";
import { RateLimiter } from "./rate-limit.ts";
import { DEFAULT_BOARD_KEYWORDS } from "./types.ts";
import type { PinsFetchOptions, PinsPage, PinterestBoard, PinterestPin } from "./types.ts";

const PINTEREST_API_BASE = "https://api.pinterest.com/v5";

/** Thrown when Pinterest keeps rate-limiting; the orchestrator reschedules. */
export class PinterestRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinterestRateLimitError";
  }
}

/**
 * Pinterest API v5 client.
 *
 * - OAuth 2.0 Bearer token from config (PINTEREST_ACCESS_TOKEN)
 * - 10 requests/second enforced locally by a rate limiter (spec 6.1)
 * - 429 / 5xx retried with exponential backoff
 * - persistent rate limiting surfaces as PinterestRateLimitError so the
 *   daily workflow can reschedule the source to the next hour window
 */
export class PinterestApiClient {
  private readonly token: string;
  private readonly rateLimiter: RateLimiter;
  private readonly baseUrl: string;

  constructor(token?: string) {
    const cfg = getConfig();
    this.token = token ?? cfg.PINTEREST_ACCESS_TOKEN;
    if (!this.token) {
      throw new Error("PINTEREST_ACCESS_TOKEN is required for the real Pinterest API provider");
    }
    this.rateLimiter = new RateLimiter(cfg.PINTEREST_RATE_LIMIT_PER_SEC);
    this.baseUrl = PINTEREST_API_BASE;
  }

  /**
   * Discover boards matching the ethnic-wear keywords from the spec
   * (sarees, lehengas, salwar suits, kurtas, fusion wear) via
   * GET /v5/search/boards. Deduplicated by board id.
   */
  async listBoards(keywords: string[] = DEFAULT_BOARD_KEYWORDS): Promise<PinterestBoard[]> {
    const boards: PinterestBoard[] = [];
    const seen = new Set<string>();
    for (const keyword of keywords) {
      const query = new URLSearchParams({ query: keyword, page_size: "25" });
      const url = `${this.baseUrl}/search/boards?${query}`;
      const data = await this.rateLimiter.run(() => this.request(url));
      for (const item of (data.items ?? []) as PinterestBoard[]) {
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        boards.push(item);
      }
    }
    return boards;
  }

  /**
   * Fetch one page of pins for a board. `bookmark` is the opaque v5 cursor;
   * returns an empty bookmark when there are no more pages.
   */
  async getBoardPins(boardId: string, options: PinsFetchOptions = {}): Promise<PinsPage> {
    const pageSize = options.pageSize ?? 100;
    const query = new URLSearchParams({ page_size: String(pageSize) });
    if (options.bookmark) query.set("bookmark", options.bookmark);

    const url = `${this.baseUrl}/boards/${encodeURIComponent(boardId)}/pins?${query}`;
    const data = await this.rateLimiter.run(() => this.request(url));
    return {
      items: (data.items ?? []) as PinterestPin[],
      bookmark: typeof data.bookmark === "string" ? data.bookmark : "",
    };
  }

  private async request(url: string): Promise<Record<string, unknown>> {
    return retryWithBackoff(
      async () => {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        });
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          getLogger().warn("pinterest: rate limited", { url, retryAfter });
          throw new HttpError(`pinterest rate limited (retry-after=${retryAfter ?? "?"})`, 429);
        }
        if (!response.ok) {
          throw new HttpError(`pinterest GET ${url} -> ${response.status}`, response.status);
        }
        return (await response.json()) as Record<string, unknown>;
      },
      {
        attempts: 5,
        baseDelayMs: 2000,
        maxDelayMs: 60000,
        shouldRetry: (error) =>
          error instanceof HttpError && (error.status === 429 || error.status >= 500),
      },
    ).catch((error) => {
      // After retries, a 429 means "reschedule this source".
      if (error instanceof HttpError && error.status === 429) {
        throw new PinterestRateLimitError("pinterest rate limit exceeded after retries");
      }
      throw error;
    });
  }
}