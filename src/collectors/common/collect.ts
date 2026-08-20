import { randomUUID, createHash } from "node:crypto";
import type { DbClient } from "../../db/types.ts";
import { getLogger } from "../../shared/logger.ts";
import type { ObjectStorage } from "../../storage/types.ts";
import { downloadImage } from "./download.ts";
import type { CollectionSummary, SourceAdapter } from "./types.ts";

export interface CollectOptions {
  db: DbClient;
  storage: ObjectStorage;
  /** Human label used in storage keys, defaults to adapter.source. */
  log?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Shared collection runner: fetch -> normalize -> save.
 *
 * Per item:
 *  1. skip items without an image URL (log + count)
 *  2. skip source URLs already present (DB unique constraint is the guard;
 *     we pre-check to keep logs clean and avoid wasted downloads)
 *  3. download the image, then backup to object storage
 *  4. on S3 backup failure: keep image_url only, flag for retry (spec 12)
 *  5. insert into raw_trend_images with status='pending'
 *
 * A failure in one item never aborts the rest of the batch.
 */
export async function collectFromSource(
  adapter: SourceAdapter,
  options: CollectOptions,
): Promise<CollectionSummary> {
  const { db, storage } = options;
  const logger = getLogger();
  const log = options.log ?? logger.info.bind(logger);

  const summary: CollectionSummary = {
    source: adapter.source,
    fetched: 0,
    saved: 0,
    skippedDuplicate: 0,
    skippedMissingImage: 0,
    failed: 0,
  };

  const items = await adapter.fetchRaw();
  summary.fetched = items.length;
  log(`collection: fetched ${items.length} items`, { source: adapter.source });

  // Spec 6.2: store a raw HTML snapshot in object storage for audit.
  if (adapter.fetchRawHtml) {
    try {
      const snapshot = await adapter.fetchRawHtml();
      if (snapshot) {
        const snapshotKey = `${adapter.source}/raw-html/${today()}/${sha256(snapshot.url).slice(0, 16)}.html`;
        await storage.put(snapshotKey, new TextEncoder().encode(snapshot.html), "text/html; charset=utf-8");
        log("collection: raw HTML snapshot stored", { source: adapter.source, snapshotKey });
      }
    } catch (error) {
      logger.warn("collection: raw HTML snapshot failed", {
        source: adapter.source,
        error: (error as Error).message,
      });
    }
  }

  for (const item of items) {
    const ctx = { source: adapter.source, sourceUrl: item.sourceUrl };
    try {
      if (!item.imageUrl) {
        summary.skippedMissingImage++;
        log("collection: skipped, no image URL", ctx);
        continue;
      }

      const existing = await db.query("SELECT 1 FROM raw_trend_images WHERE source_url = $1", [item.sourceUrl]);
      if (existing.rows.length > 0) {
        summary.skippedDuplicate++;
        log("collection: skipped, duplicate source URL", ctx);
        continue;
      }

      const id = randomUUID();
      let s3Key: string | null = null;
      try {
        const { data, contentType } = await downloadImage(item.imageUrl);
        const ext = extFromUrl(item.imageUrl);
        s3Key = `${adapter.source}/${item.collectedAt?.toISOString().slice(0, 10) ?? today()}/${id}.${ext}`;
        await storage.put(s3Key, data, contentType ?? undefined);
      } catch (error) {
        // Spec 12 "S3 image backup failure": keep image_url only; flag for retry.
        logger.warn("collection: image download/backup failed, storing URL only", {
          ...ctx,
          error: (error as Error).message,
        });
        s3Key = null;
      }

      await db.query(
        `INSERT INTO raw_trend_images (id, source, source_url, image_url, image_s3_key, raw_metadata, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending')`,
        [
          id,
          adapter.source,
          item.sourceUrl,
          item.imageUrl,
          s3Key,
          JSON.stringify(item.raw),
        ],
      );
      summary.saved++;
    } catch (error) {
      summary.failed++;
      logger.error("collection: item failed", {
        ...ctx,
        error: (error as Error).message,
      });
    }
  }

  log(`collection: done`, { ...summary });
  return summary;
}

function extFromUrl(url: string): string {
  const match = /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.exec(url);
  return match?.[1]?.toLowerCase() ?? "jpg";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}