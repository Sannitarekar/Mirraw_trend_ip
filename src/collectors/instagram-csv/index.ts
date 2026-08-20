import { readFile } from "node:fs/promises";
import { parseCsv } from "../common/csv.ts";
import type { RawSourceItem, SourceAdapter } from "../common/types.ts";

export interface InstagramCsvRow {
  sourceUrl: string;
  imageUrl: string;
  description: string;
  postedAt: string; // ISO date
}

/**
 * Instagram source adapter — manual influencer-looks CSV upload.
 *
 * The spec lists Instagram as a manual weekly export (no API). The CSV
 * contract is documented in README / sample-data (ASSUMPTIONS.md #10):
 *
 *   source_url,image_url,description,posted_at
 *   https://instagram.com/p/xyz,https://cdn.../img.jpg,"festive saree look",2026-08-01
 *
 * Each row becomes a pending raw_trend_images record via the shared runner.
 */
export class InstagramCsvAdapter implements SourceAdapter {
  readonly source = "instagram";
  private readonly csvPath: string;
  private readonly defaultCollectedAt: Date;

  constructor(csvPath: string, defaultCollectedAt = new Date()) {
    this.csvPath = csvPath;
    this.defaultCollectedAt = defaultCollectedAt;
  }

  async fetchRaw(): Promise<RawSourceItem[]> {
    const text = await readFile(this.csvPath, "utf8");
    const rows = parseCsv(text);
    if (rows.length === 0) return [];

    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const urlIdx = header.indexOf("source_url");
    const imgIdx = header.indexOf("image_url");
    const descIdx = header.indexOf("description");
    const postedIdx = header.indexOf("posted_at");

    if (urlIdx === -1 || imgIdx === -1) {
      throw new Error(
        "instagram CSV must contain source_url and image_url columns",
      );
    }

    const items: RawSourceItem[] = [];
    for (const row of rows.slice(1)) {
      const sourceUrl = (row[urlIdx] ?? "").trim();
      const imageUrl = (row[imgIdx] ?? "").trim();
      if (!sourceUrl || !imageUrl) continue; // malformed rows are skipped, not fatal

      const description = descIdx >= 0 ? (row[descIdx] ?? "").trim() : "";
      const postedAt = postedIdx >= 0 ? (row[postedIdx] ?? "").trim() : "";

      items.push({
        sourceUrl,
        imageUrl,
        raw: { description, posted_at: postedAt, file: this.csvPath },
        collectedAt: postedAt ? new Date(postedAt) : this.defaultCollectedAt,
      });
    }
    return items;
  }
}

/** Validate and type-check a raw CSV row (used by tests). */
export function normalizeInstagramRow(
  sourceUrl: string,
  imageUrl: string,
  description: string,
  postedAt: string,
): InstagramCsvRow {
  if (!sourceUrl || !imageUrl) {
    throw new Error("instagram row requires source_url and image_url");
  }
  return { sourceUrl, imageUrl, description, postedAt };
}