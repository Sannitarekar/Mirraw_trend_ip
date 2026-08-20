import { createHash } from "node:crypto";
import { UNKNOWN } from "./types.ts";
import type { TrendAttributes, VisionImageInput, VisionProvider } from "./types.ts";

const GARMENTS = ["saree", "lehenga", "anarkali", "kurta", "sharara", "coord set"];
const COLORS = [
  ["ivory", "gold"],
  ["mint green", "champagne"],
  ["crimson", "gold"],
  ["royal blue", "silver"],
  ["pastel pink", "white"],
  ["emerald", "black"],
];
const PATTERNS = ["floral", "solid", "paisley", "geometric", "bandhani", "abstract"];
const FABRICS = ["silk", "chiffon", "georgette", "velvet", "cotton", "organza"];
const EMBELLISHMENTS = ["zari", "sequins", "embroidery", "mirror work", "none", "zardozi"];
const SILHOUETTES = ["A-line", "straight", "flared", "fitted"];
const OCCASIONS = ["wedding", "festive", "casual", "party", "daily wear", "festive"];
const NECKLINES = ["round", "V-neck", "square", "halter", "boat"];
const SLEEVES = ["sleeveless", "3/4", "full", "bell"];
const SEASONS = ["summer 2026", "festive 2026", "winter 2026"];

const pool = [GARMENTS, COLORS, PATTERNS, FABRICS, EMBELLISHMENTS, SILHOUETTES, OCCASIONS, NECKLINES, SLEEVES, SEASONS];

function hashSeed(bytes: Uint8Array): number {
  const hex = createHash("sha256").update(bytes).digest("hex");
  return parseInt(hex.slice(0, 8), 16);
}

/**
 * Deterministic mock of a vision model.
 *
 * IMPORTANT: this is a demo fixture, not real visual understanding. It derives
 * attribute sets from the image's content hash, so the same image always
 * yields the same attributes (stable for scoring/dedup demos). ~1 in 6 fields
 * is forced to 'unknown' to exercise attribute-completeness scoring.
 */
export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";

  async analyze(image: VisionImageInput): Promise<TrendAttributes> {
    const seed = hashSeed(image.bytes);
    const pick = (arr: unknown[], i: number) => arr[i % arr.length];

    const forceUnknown = (i: number) => seed % 6 === i;

    return {
      garment_type: forceUnknown(0) ? UNKNOWN : (pick(GARMENTS, seed >>> 0) as string),
      color_palette: forceUnknown(1) ? [UNKNOWN] : (pick(COLORS, seed >>> 3) as string[]),
      pattern: forceUnknown(2) ? UNKNOWN : (pick(PATTERNS, seed >>> 5) as string),
      fabric_texture: forceUnknown(3) ? UNKNOWN : (pick(FABRICS, seed >>> 7) as string),
      embellishment: forceUnknown(4) ? UNKNOWN : (pick(EMBELLISHMENTS, seed >>> 9) as string),
      silhouette: forceUnknown(0) ? UNKNOWN : (pick(SILHOUETTES, seed >>> 11) as string),
      occasion: forceUnknown(1) ? UNKNOWN : (pick(OCCASIONS, seed >>> 13) as string),
      neckline: forceUnknown(2) ? UNKNOWN : (pick(NECKLINES, seed >>> 15) as string),
      sleeve_style: forceUnknown(3) ? UNKNOWN : (pick(SLEEVES, seed >>> 17) as string),
      trend_season: forceUnknown(4) ? UNKNOWN : (pick(SEASONS, seed >>> 19) as string),
    };
  }
}

export const UNKNOWN_TOKEN = UNKNOWN;