import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types.ts";
import type { AppConfig } from "../shared/config.ts";
import { getConfig } from "../shared/config.ts";
import type { SlackNotifier } from "../slack/index.ts";
import { createSlackNotifier } from "../slack/index.ts";
import { selectDuplicatesToDiscard } from "../dedup/index.ts";
import { calculateTrendScore, shouldDiscard } from "./index.ts";
import type { TrendAttributesLike } from "./types.ts";

/** Result of one Workflow 3 run (score, deduplicate, promote). */
export interface PromotionSummary {
  scored: number;
  discarded: number;
  deduplicated: number;
  promoted: number;
  feedDate: string;
}

interface ScoredRow {
  id: string;
  source: string;
  collectedAt: Date;
  saveCount: number;
  attributes: TrendAttributesLike;
  phash: string | null;
  total: number;
}

/**
 * Workflow 3: Scoring & Promotion.
 *
 * 1. Takes every analyzed image, computes the composite trend score from its
 *    attributes, source authority, save count and age.
 * 2. Marks low scorers 'discarded'; deduplicates near-identical images via
 *    pHash (keeping the higher-scored one).
 * 3. Promotes the top TREND_FEED_PROMOTE_LIMIT of the day into TREND_FEED.
 * 4. Sends the daily summary to #product-ai via Slack.
 */
export class ScoringService {
  private readonly db: DbClient;
  private readonly config: AppConfig;
  private readonly notifier: SlackNotifier;

  constructor(db: DbClient, notifier: SlackNotifier = createSlackNotifier(), config: AppConfig = getConfig()) {
    this.db = db;
    this.notifier = notifier;
    this.config = config;
  }

  async scoreAndPromote(now = new Date()): Promise<PromotionSummary> {
    const rows = await this.fetchAnalyzedRows();

    const scored: ScoredRow[] = [];
    let discarded = 0;
    for (const row of rows) {
      const total = calculateTrendScore({
        saveCount: row.saveCount,
        collectedAt: row.collectedAt,
        source: row.source,
        attributes: row.attributes,
        now,
      }).total;

      const isDiscarded = shouldDiscard(total, this.config);
      await this.db.query("UPDATE trend_image_attributes SET trend_score=$1 WHERE raw_image_id=$2", [total, row.id]);
      await this.db.query("UPDATE raw_trend_images SET status=$1 WHERE id=$2", [isDiscarded ? "discarded" : "scored", row.id]);
      if (isDiscarded) {
        discarded++;
      } else {
        scored.push({ ...row, total });
      }
    }

    const deduplicated = await this.markDeduplicated(scored);
    const feedDate = now.toISOString().slice(0, 10);
    const promoted = await this.promoteTop(
      scored.filter((s) => !deduplicated.has(s.id)),
      feedDate,
    );

    const summary: PromotionSummary = {
      scored: scored.length + discarded,
      discarded,
      deduplicated: deduplicated.size,
      promoted,
      feedDate,
    };
    await this.sendSummary(summary);
    return summary;
  }

  /** Mark near-duplicates as discarded; returns the set of discarded ids. */
  private async markDeduplicated(scored: ScoredRow[]): Promise<Set<string>> {
    const toDiscard = selectDuplicatesToDiscard(
      scored.map((s) => ({ id: s.id, phash: s.phash, trendScore: s.total })),
      this.config.DEDUP_PHASH_DISTANCE_THRESHOLD,
    );
    for (const id of toDiscard) {
      await this.db.query("UPDATE raw_trend_images SET status='discarded' WHERE id=$1", [id]);
    }
    return new Set(toDiscard);
  }

  /** Upsert today's top N scored images into TREND_FEED; returns count. */
  private async promoteTop(scored: ScoredRow[], feedDate: string): Promise<number> {
    const ranked = [...scored].sort((a, b) => b.total - a.total).slice(0, this.config.TREND_FEED_PROMOTE_LIMIT);
    for (let i = 0; i < ranked.length; i++) {
      const entry = ranked[i] as ScoredRow;
      await this.db.query(
        `INSERT INTO trend_feed (id, raw_image_id, trend_score, feed_date, rank)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (feed_date, raw_image_id)
         DO UPDATE SET trend_score = EXCLUDED.trend_score, rank = EXCLUDED.rank, promoted_at = now()`,
        [randomUUID(), entry.id, entry.total, feedDate, i + 1],
      );
    }
    return ranked.length;
  }

  private async fetchAnalyzedRows(): Promise<ScoredRow[]> {
    const { rows } = await this.db.query(
      `SELECT r.id, r.source, r.collected_at, r.raw_metadata,
              a.garment_type, a.color_palette, a.pattern, a.fabric_texture,
              a.embellishment, a.silhouette, a.occasion, a.neckline,
              a.sleeve_style, a.trend_season, a.phash
       FROM raw_trend_images r
       JOIN trend_image_attributes a ON a.raw_image_id = r.id
       WHERE r.status = 'analyzed'`,
    );
    return rows.map((r) => {
      const metadata = parseMetadata(r.raw_metadata);
      return {
        id: r.id as string,
        source: r.source as string,
        collectedAt: new Date(r.collected_at as string),
        saveCount: Number((metadata?.pin_metrics?.save_count as number | undefined) ?? 0),
        attributes: {
          garment_type: r.garment_type as string,
          color_palette: Array.isArray(r.color_palette) ? (r.color_palette as string[]) : [],
          pattern: r.pattern as string,
          fabric_texture: r.fabric_texture as string,
          embellishment: r.embellishment as string,
          silhouette: r.silhouette as string,
          occasion: r.occasion as string,
          neckline: r.neckline as string,
          sleeve_style: r.sleeve_style as string,
          trend_season: r.trend_season as string,
        },
        phash: (r.phash as string | null) ?? null,
        total: 0,
      };
    });
  }

  private async sendSummary(summary: PromotionSummary): Promise<void> {
    const text = [
      "Trend Intelligence Platform — daily scoring summary",
      `Feed date: ${summary.feedDate}`,
      `Scored: ${summary.scored}`,
      `Discarded (below threshold): ${summary.discarded}`,
      `Deduplicated (near-duplicates): ${summary.deduplicated}`,
      `Promoted to TREND_FEED: ${summary.promoted}`,
    ].join("\n");
    await this.notifier.send(text);
  }
}

function parseMetadata(raw: unknown): { pin_metrics?: { save_count?: number } } | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as { pin_metrics?: { save_count?: number } };
    } catch {
      return null;
    }
  }
  return raw as { pin_metrics?: { save_count?: number } };
}