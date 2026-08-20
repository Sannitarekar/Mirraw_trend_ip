import { getConfig } from "../../shared/config.ts";
import { getLogger } from "../../shared/logger.ts";
import type { RawSourceItem, SourceAdapter } from "../common/types.ts";
import { PinterestApiClient, PinterestRateLimitError } from "./api.ts";
import { MockPinterestProvider } from "./mock.ts";
import type { PinterestBoard, PinterestPin } from "./types.ts";

interface PinterestProvider {
  listBoards(): Promise<PinterestBoard[]>;
  getBoardPins(boardId: string, options?: { pageSize?: number; bookmark?: string }): Promise<{
    items: PinterestPin[];
    bookmark: string;
  }>;
}

/**
 * Pinterest source adapter.
 *
 * Discovers boards matching the ethnic-wear keywords from the spec
 * (sarees, lehengas, salwar suits, kurtas, fusion wear), paginates each
 * board's pins (page_size=100 + bookmark), and normalizes each pin into the
 * shared RawSourceItem shape. Save counts live in pin_metrics.save_count.
 *
 * Provider is selected by config:
 *   PINTEREST_PROVIDER=api  -> real Pinterest API v5 (needs OAuth token)
 *   PINTEREST_PROVIDER=mock -> deterministic local fixture (default demo)
 */
export class PinterestAdapter implements SourceAdapter {
  readonly source = "pinterest";
  private readonly provider: PinterestProvider;

  constructor(provider?: PinterestProvider) {
    const cfg = getConfig();
    this.provider = provider ?? (cfg.PINTEREST_PROVIDER === "api" ? new PinterestApiClient() : new MockPinterestProvider());
  }

  async fetchRaw(): Promise<RawSourceItem[]> {
    const logger = getLogger();
    const boards = await this.provider.listBoards();
    logger.info("pinterest: boards discovered", { count: boards.length });

    const items: RawSourceItem[] = [];
    for (const board of boards) {
      let bookmark = "";
      let pages = 0;
      do {
        const page = await this.provider.getBoardPins(board.id, { pageSize: 100, bookmark });
        for (const pin of page.items) {
          const item = this.normalizePin(pin, board);
          if (item) items.push(item);
        }
        pages++;
        bookmark = page.bookmark;
      } while (bookmark && pages < 20); // hard cap: 20 pages per board per run
    }
    return items;
  }

  private normalizePin(pin: PinterestPin, board: PinterestBoard): RawSourceItem | null {
    const imageUrl =
      pin.media?.images?.["600x"]?.url ?? pin.media?.images?.["originals"]?.url ?? pin.media?.images?.["1200x"]?.url;
    if (!imageUrl) return null; // pins without images are skipped

    const sourceUrl = pin.link ?? `https://www.pinterest.com/pin/${pin.id}/`;
    const raw: Record<string, unknown> = {
      ...(pin as unknown as Record<string, unknown>),
      board_name: board.name,
      board_id: board.id,
    };
    const item: RawSourceItem = { sourceUrl, imageUrl, raw };
    if (pin.created_at) {
      item.collectedAt = new Date(pin.created_at);
    }
    return item;
  }
}

export { PinterestRateLimitError };
export type { PinterestProvider };