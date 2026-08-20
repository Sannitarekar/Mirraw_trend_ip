import { hammingDistance } from "./phash.ts";

/**
 * Near-duplicate detection for Workflow 3 (Scoring & Promotion).
 *
 * Images are grouped by perceptual hash distance. Within a group we keep the
 * highest-scoring image and discard the others (spec section 12: "pHash
 * collision (near-duplicate) -> Keep higher-scored image; discard the other").
 */

/** A scored image candidate for deduplication. */
export interface ScoredImage {
  id: string;
  phash: string | null;
  trendScore: number;
}

/**
 * Given scored images, returns the ids to discard: for every pair within
 * `threshold` bits (hamming distance), the lower-scoring image is discarded.
 * Images without a phash are never deduplicated.
 */
export function selectDuplicatesToDiscard(images: ScoredImage[], threshold: number): string[] {
  // Highest score first so the first representative of each group is the keeper.
  const sorted = [...images].sort((a, b) => b.trendScore - a.trendScore);
  const keepers: ScoredImage[] = [];
  const discard = new Set<string>();

  for (const image of sorted) {
    if (!image.phash || discard.has(image.id)) continue;
    const nearDuplicate = keepers.some(
      (keeper) => keeper.phash !== null && hammingDistance(image.phash as string, keeper.phash) <= threshold,
    );
    if (nearDuplicate) {
      discard.add(image.id);
    } else {
      keepers.push(image);
    }
  }

  return [...discard];
}