import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types.ts";
import type { AppConfig } from "../shared/config.ts";
import { getConfig } from "../shared/config.ts";
import { getLogger } from "../shared/logger.ts";

/** Filters for GET /api/v1/trends/feed (spec section 10). */
export interface FeedFilters {
  /** ISO date, default today - 7 days. */
  dateFrom?: string;
  /** ISO date, default today. */
  dateTo?: string;
  garmentType?: string;
  occasion?: string;
  /** Minimum trend score, default 40. */
  minScore?: number;
  /** Max results, default 50, max 200. */
  limit?: number;
  /** 1-based page. */
  page?: number;
}

export interface FeedImage {
  id: string;
  image_s3_url: string;
  attributes: {
    garment_type: string;
    color_palette: string[];
    pattern: string;
    fabric_texture: string;
    embellishment: string;
    silhouette: string;
    occasion: string;
    neckline: string;
    sleeve_style: string;
    trend_season: string;
  };
  trend_score: number;
  source: string;
  collected_at: string;
}

export interface FeedResponse {
  images: FeedImage[];
  total: number;
  page: number;
  has_more: boolean;
}

const MAX_LIMIT = 200;

/**
 * Read the promoted feed for a date range with optional garment/occasion
 * filters and a minimum score. Reads exclusively from TREND_FEED (spec: the
 * API consumes only promoted, top-scored images).
 */
export async function queryTrendFeed(
  db: DbClient,
  config: AppConfig = getConfig(),
  filters: FeedFilters = {},
): Promise<FeedResponse> {
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = filters.dateFrom ?? daysAgo(today, 7);
  const dateTo = filters.dateTo ?? today;
  const minScore = filters.minScore ?? 40;
  const limit = Math.min(filters.limit ?? 50, MAX_LIMIT);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const where = [
    "f.feed_date >= $1::date",
    "f.feed_date <= $2::date",
    "f.trend_score >= $3",
  ];
  const params: unknown[] = [dateFrom, dateTo, minScore];
  if (filters.garmentType) {
    params.push(filters.garmentType);
    where.push(`a.garment_type = $${params.length}`);
  }
  if (filters.occasion) {
    params.push(filters.occasion);
    where.push(`a.occasion = $${params.length}`);
  }
  const whereSql = where.join(" AND ");

  const countResult = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM trend_feed f
     JOIN trend_image_attributes a ON a.raw_image_id = f.raw_image_id
     WHERE ${whereSql}`,
    params,
  );
  const total = (countResult.rows[0] as { n: number } | undefined)?.n ?? 0;

  const dataResult = await db.query(
    `SELECT f.id, f.trend_score, r.source, r.collected_at, r.image_s3_key, r.image_url,
            a.garment_type, a.color_palette, a.pattern, a.fabric_texture,
            a.embellishment, a.silhouette, a.occasion, a.neckline,
            a.sleeve_style, a.trend_season
     FROM trend_feed f
     JOIN raw_trend_images r ON r.id = f.raw_image_id
     JOIN trend_image_attributes a ON a.raw_image_id = f.raw_image_id
     WHERE ${whereSql}
     ORDER BY f.trend_score DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const images: FeedImage[] = dataResult.rows.map((row) => ({
    id: row.id as string,
    image_s3_url: imageUrl(row, config),
    attributes: {
      garment_type: row.garment_type as string,
      color_palette: Array.isArray(row.color_palette) ? (row.color_palette as string[]) : [],
      pattern: row.pattern as string,
      fabric_texture: row.fabric_texture as string,
      embellishment: row.embellishment as string,
      silhouette: row.silhouette as string,
      occasion: row.occasion as string,
      neckline: row.neckline as string,
      sleeve_style: row.sleeve_style as string,
      trend_season: row.trend_season as string,
    },
    trend_score: Number(row.trend_score),
    source: row.source as string,
    collected_at: (row.collected_at as Date).toISOString(),
  }));

  return { images, total, page, has_more: offset + images.length < total };
}

function imageUrl(row: Record<string, unknown>, config: AppConfig): string {
  const key = row.image_s3_key as string | null;
  if (key) return `${config.CDN_BASE_URL.replace(/\/$/, "")}/${key}`;
  return row.image_url as string;
}

function daysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * POST /api/v1/trends/{id}/used. Enforces the 3-uses-per-image-per-month cap.
 * A feed entry id is resolved to its underlying image, the parent
 * raw_trend_images row is locked FOR UPDATE (serializing concurrent calls),
 * the current UTC month's usage is counted, and a new usage row is inserted.
 */
export async function recordUsage(
  db: DbClient,
  feedEntryId: string,
  config: AppConfig = getConfig(),
): Promise<{ ok: true; usageCount: number } | { ok: false; status: number; reason: string }> {
  const month = new Date().toISOString().slice(0, 7);

  try {
    return await db.inTransaction(async (tx) => {
      const feed = await tx.query<{ raw_image_id: string }>(
        "SELECT raw_image_id FROM trend_feed WHERE id = $1 FOR UPDATE",
        [feedEntryId],
      );
      const rawImageId = feed.rows[0]?.raw_image_id;
      if (!rawImageId) {
        return { ok: false, status: 404, reason: "feed entry not found" } as const;
      }

      // Serialize /used calls for the same underlying image.
      await tx.query("SELECT 1 FROM raw_trend_images WHERE id = $1 FOR UPDATE", [rawImageId]);

      const usage = await tx.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM trend_image_usage WHERE raw_image_id = $1 AND usage_month = $2",
        [rawImageId, month],
      );
      const count = usage.rows[0]?.n ?? 0;
      if (count >= config.MAX_USES_PER_IMAGE_PER_MONTH) {
        return {
          ok: false,
          status: 429,
          reason: `image used ${count} times this month (max ${config.MAX_USES_PER_IMAGE_PER_MONTH})`,
        } as const;
      }

      await tx.query(
        "INSERT INTO trend_image_usage (id, raw_image_id, usage_month) VALUES ($1, $2, $3)",
        [randomUUID(), rawImageId, month],
      );
      return { ok: true, usageCount: count + 1 } as const;
    });
  } catch (error) {
    getLogger().error("api: recordUsage failed", { error: (error as Error).message });
    return { ok: false, status: 500, reason: "internal error" };
  }
}