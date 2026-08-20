import type { AppConfig } from "../shared/config.ts";
import { getConfig } from "../shared/config.ts";
import { UNKNOWN } from "../vision/types.ts";
import { sourceAuthority } from "./authority.ts";
import type { ScoreBreakdown, ScoringInput, TrendAttributesLike } from "./types.ts";

const ATTRIBUTE_KEYS: (keyof TrendAttributesLike)[] = [
  "garment_type",
  "color_palette",
  "pattern",
  "fabric_texture",
  "embellishment",
  "silhouette",
  "occasion",
  "neckline",
  "sleeve_style",
  "trend_season",
];

function isUnknown(value: string | string[]): boolean {
  if (Array.isArray(value)) return value.length === 0 || value.every((v) => v.trim().toLowerCase() === UNKNOWN);
  return value.trim().toLowerCase() === UNKNOWN || value.trim() === "";
}

/** Count of attributes with a real value (spec: attribute completeness). */
export function unknownCount(attributes: TrendAttributesLike): number {
  return ATTRIBUTE_KEYS.filter((key) => isUnknown(attributes[key])).length;
}

/** 0..40. Normalised social saves against a reference max (spec 9.3). */
export function saveScore(saveCount: number, config: AppConfig = getConfig()): number {
  const normalized = Math.min(saveCount / config.SAVE_COUNT_REFERENCE_MAX, 1);
  return round1(normalized * 40);
}

/** 0..30. Linear decay from 30 at t=0 to 0 after RECENCY_WINDOW_DAYS. */
export function recencyScore(collectedAt: Date, now: Date, config: AppConfig = getConfig()): number {
  const windowMs = config.RECENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const ageMs = Math.max(0, now.getTime() - collectedAt.getTime());
  return round1(Math.max(0, 1 - ageMs / windowMs) * 30);
}

/** 0..20. Source authority coefficient scaled to the 20% weight. */
export function authorityScore(source: string, config: AppConfig = getConfig()): number {
  return round1(sourceAuthority(source, config) * 20);
}

/**
 * 0..10. Completeness = known/10 scaled to the 10% weight. Per spec, an image
 * whose attributes are more than 3/10 unknown earns no completeness credit at
 * all (too vague to be a useful trend signal).
 */
export function completenessScore(attributes: TrendAttributesLike): number {
  const known = 10 - unknownCount(attributes);
  if (known < 7) return 0; // more than 3 unknowns
  return known;
}

/**
 * Composite trend score (0..100): saves 40%, recency 30%, authority 20%,
 * completeness 10%. Records below TREND_SCORE_DISCARD_THRESHOLD are
 * discarded rather than promoted (spec 9.3).
 */
export function calculateTrendScore(input: ScoringInput): ScoreBreakdown {
  const config = getConfig();
  const now = input.now ?? new Date();
  const saves = saveScore(input.saveCount, config);
  const recency = recencyScore(input.collectedAt, now, config);
  const authority = authorityScore(input.source, config);
  const completeness = completenessScore(input.attributes);
  const known = 10 - unknownCount(input.attributes);
  const total = round1(Math.min(100, saves + recency + authority + completeness));

  return { total, saves, recency, authority, completeness, knownCount: known, unknownCount: 10 - known };
}

/** Whether a scored image is below the discard threshold. */
export function shouldDiscard(score: number, config: AppConfig = getConfig()): boolean {
  return score < config.TREND_SCORE_DISCARD_THRESHOLD;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}