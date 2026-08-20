/**
 * Trend score input (spec section 9.3).
 *
 * A composite score (0-100) is derived from the four spec-defined signals:
 * social saves (40%), recency (30%), source authority (20%), and attribute
 * completeness (10%). Scores below TREND_SCORE_DISCARD_THRESHOLD are
 * discarded; the top TREND_FEED_PROMOTE_LIMIT per day are promoted to the feed.
 */
export interface TrendAttributesLike {
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
}

export interface ScoringInput {
  saveCount: number;
  collectedAt: Date;
  source: string;
  attributes: TrendAttributesLike;
  now?: Date;
}

export interface ScoreBreakdown {
  /** Composite 0-100, rounded to 1 decimal. */
  total: number;
  saves: number;
  recency: number;
  authority: number;
  completeness: number;
  /** Number of attributes whose value is not 'unknown'. */
  knownCount: number;
  /** Number of attributes whose value is 'unknown'. */
  unknownCount: number;
}
