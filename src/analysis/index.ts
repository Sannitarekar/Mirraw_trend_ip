import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types.ts";
import { getConfig } from "../shared/config.ts";
import { getLogger } from "../shared/logger.ts";
import type { ObjectStorage } from "../storage/types.ts";
import { downloadImage } from "../collectors/common/download.ts";
import { retryWithBackoff } from "../collectors/common/retry.ts";
import { computePHash } from "../dedup/phash.ts";
import type { TrendAttributes, VisionImageInput, VisionProvider } from "../vision/types.ts";
import { ATTRIBUTE_KEYS, UNKNOWN } from "../vision/types.ts";

export interface AnalysisSummary {
  pending: number;
  analyzed: number;
  failed: number;
  skippedNoImage: number;
}

interface PendingRow {
  id: string;
  image_url: string;
  image_s3_key: string | null;
}

/**
 * Analysis workflow (spec section 11, Workflow 2).
 *
 * Polls raw_trend_images for status='pending' in batches of 20, sends each
 * image to the vision provider, stores attributes in trend_image_attributes,
 * and sets status='analyzed'.
 *
 * Failure policy (spec 12): vision timeout/API failure is retried up to 3x
 * with a 30s delay; after the 3rd failure the image is marked
 * 'analysis_failed' and logged for review. A malformed model response is
 * treated as a failure of the same kind (never a silent success).
 */
export class AnalysisService {
  private readonly db: DbClient;
  private readonly storage: ObjectStorage;
  private readonly provider: VisionProvider;
  private readonly retryDelayMs: number;
  private readonly batchSize: number;

  constructor(
    db: DbClient,
    storage: ObjectStorage,
    provider: VisionProvider,
    retryDelayMs = getConfig().NODE_ENV === "test" ? 1 : 30_000,
    batchSize = 20,
  ) {
    this.db = db;
    this.storage = storage;
    this.provider = provider;
    this.retryDelayMs = retryDelayMs;
    this.batchSize = batchSize;
  }

  async analyzePending(limit = 500): Promise<AnalysisSummary> {
    const logger = getLogger();
    const summary: AnalysisSummary = { pending: 0, analyzed: 0, failed: 0, skippedNoImage: 0 };

    const batches = await this.fetchPendingBatches(limit);
    for (const batch of batches) {
      logger.info("analysis: processing batch", { size: batch.length });
      for (const row of batch) {
        try {
          const image = await this.loadImage(row);
          if (!image) {
            summary.skippedNoImage++;
            continue;
          }
          const attrs = await this.analyzeWithRetry(image);
          const phash = await this.computePHashSafe(image.bytes);
          await this.saveAttributes(row.id, attrs, phash);
          await this.db.query("UPDATE raw_trend_images SET status='analyzed' WHERE id=$1", [row.id]);
          summary.analyzed++;
        } catch (error) {
          summary.failed++;
          logger.error("analysis: image failed after retries", {
            imageId: row.id,
            provider: this.provider.name,
            error: (error as Error).message,
          });
          await this.db
            .query("UPDATE raw_trend_images SET status='analysis_failed' WHERE id=$1", [row.id])
            .catch(() => undefined);
        }
      }
    }
    logger.info("analysis: done", { ...summary, provider: this.provider.name });
    return summary;
  }

  /** Fetch pending rows in chunks of `batchSize`. */
  private async fetchPendingBatches(limit: number): Promise<PendingRow[][]> {
    const { rows } = await this.db.query<PendingRow>(
      `SELECT id, image_url, image_s3_key FROM raw_trend_images
       WHERE status = 'pending'
       ORDER BY collected_at
       LIMIT $1`,
      [limit],
    );
    const batches: PendingRow[][] = [];
    for (let i = 0; i < rows.length; i += this.batchSize) {
      batches.push(rows.slice(i, i + this.batchSize));
    }
    return batches;
  }

  /** Bytes from object storage first, else download from image_url. */
  private async loadImage(row: PendingRow): Promise<VisionImageInput | null> {
    if (row.image_s3_key) {
      try {
        const bytes = await this.storage.get(row.image_s3_key);
        return { id: row.id, bytes: new Uint8Array(bytes), mimeType: "image/jpeg" };
      } catch (error) {
        getLogger().warn("analysis: storage read failed, falling back to URL", {
          imageId: row.id,
          key: row.image_s3_key,
          error: (error as Error).message,
        });
      }
    }
    if (row.image_url.startsWith("file://") || row.image_url.startsWith("http")) {
      const { data, contentType } = await downloadImage(row.image_url, { attempts: 2 });
      return { id: row.id, bytes: new Uint8Array(data), mimeType: contentType };
    }
    return null;
  }

  /** Spec 12: retry up to 3x with a 30s delay between attempts. */
  private async analyzeWithRetry(image: VisionImageInput): Promise<TrendAttributes> {
    return retryWithBackoff(
      () => this.provider.analyze(image),
      {
        attempts: 3,
        baseDelayMs: this.retryDelayMs,
        maxDelayMs: this.retryDelayMs,
        onRetry: (attempt, error) => {
          getLogger().warn("analysis: retrying after failure", {
            imageId: image.id,
            attempt,
            error: (error as Error).message,
          });
        },
      },
    );
  }

  private async saveAttributes(rawImageId: string, attrs: TrendAttributes, phash: string | null): Promise<void> {
    const columns = ATTRIBUTE_KEYS.join(", ");
    // color_palette needs an explicit text[] cast so the parameter type is
    // unambiguous to both PostgreSQL and PGlite. Params are $1, $2, then
    // $3..$12 for the ten attributes.
    const placeholders = ATTRIBUTE_KEYS.map((key, i) =>
      key === "color_palette" ? `$${i + 3}::text[]` : `$${i + 3}`,
    ).join(", ");
    const values = ATTRIBUTE_KEYS.map((key) => attrs[key]);
    await this.db.query(
      `INSERT INTO trend_image_attributes (id, raw_image_id, ${columns}, phash)
       VALUES ($1, $2, ${placeholders}, $13)`,
      [randomUUID(), rawImageId, ...values, phash],
    );
  }

  /** pHash is best-effort: a decode failure must not fail the whole image. */
  private async computePHashSafe(bytes: Uint8Array): Promise<string | null> {
    try {
      return await computePHash(bytes);
    } catch (error) {
      getLogger().warn("analysis: phash computation failed", {
        error: (error as Error).message,
      });
      return null;
    }
  }
}