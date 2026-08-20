import { z } from "zod";
import { UNKNOWN, ATTRIBUTE_KEYS } from "./types.ts";
import type { TrendAttributes } from "./types.ts";

/**
 * Validation layer between the raw model output and the database.
 *
 * Requirements (spec 7.1):
 *  - output must be a JSON object with the ten keys
 *  - any attribute the model is unsure about is 'unknown'
 *  - malformed responses must not break the pipeline
 *
 * Strategy:
 *  - parse JSON; throw VisionMalformedResponseError on parse failure
 *  - per-field: empty/missing/non-string -> 'unknown'
 *  - strings are trimmed and capped at the varchar(50) column width
 *  - color_palette must be an array of strings; invalid -> ['unknown']
 */
const stringAttr = z
  .string()
  .trim()
  .transform((v) => (v === "" ? UNKNOWN : v))
  .transform((v) => v.slice(0, 50))
  .catch(UNKNOWN);

const colorPaletteAttr = z
  .array(z.string().trim())
  .transform((arr) => arr.map((c) => c.slice(0, 50)).filter(Boolean))
  .transform((arr) => (arr.length === 0 ? [UNKNOWN] : arr))
  .catch(() => [UNKNOWN]);

const attributesSchema = z.object({
  garment_type: stringAttr,
  color_palette: colorPaletteAttr,
  pattern: stringAttr,
  fabric_texture: stringAttr,
  embellishment: stringAttr,
  silhouette: stringAttr,
  occasion: stringAttr,
  neckline: stringAttr,
  sleeve_style: stringAttr,
  trend_season: stringAttr,
});

/**
 * Validate parsed model output into a clean TrendAttributes object.
 * Any structurally-invalid field degrades to 'unknown' instead of failing.
 */
export function validateTrendAttributes(input: unknown): TrendAttributes {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return allUnknown();
  }
  const record = input as Record<string, unknown>;
  // Only the ten known keys are read; extra keys are dropped.
  const subset: Record<string, unknown> = {};
  for (const key of ATTRIBUTE_KEYS) {
    subset[key] = record[key];
  }
  return attributesSchema.parse(subset);
}

/**
 * Strict JSON parse for raw model text. Throws VisionMalformedResponseError
 * so the analysis job can mark the image analysis_failed (spec 12) instead of
 * silently proceeding with garbage.
 */
export function parseVisionJson(raw: string): TrendAttributes {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`not valid JSON: ${(error as Error).message}`);
  }
  return validateTrendAttributes(parsed);
}

function allUnknown(): TrendAttributes {
  const attrs: Record<string, unknown> = {};
  for (const key of ATTRIBUTE_KEYS) {
    attrs[key] = key === "color_palette" ? [UNKNOWN] : UNKNOWN;
  }
  return attrs as unknown as TrendAttributes;
}