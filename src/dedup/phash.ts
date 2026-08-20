import sharp from "sharp";

/**
 * Perceptual hash (pHash) for near-duplicate detection (spec section 9.2 /
 * Workflow 3). Classic DCT-based algorithm (pHash.org):
 *
 *   1. Downscale the image to 32x32 grayscale.
 *   2. Take the 2D DCT and keep the 8x8 block of low-frequency coefficients.
 *   3. Each bit of the hash is whether a coefficient is above the block median.
 *
 * Returns a 64-bit hash as 16 hex characters, storable in
 * trend_image_attributes.phash varchar(64).
 */

const SIZE = 32;
const LOW_FREQ = 8;
const BIT_COUNT = LOW_FREQ * LOW_FREQ;

/** DCT basis constants, precomputed once. */
const DCT_COS: number[][] = (() => {
  const table: number[][] = [];
  for (let u = 0; u < SIZE; u++) {
    const row: number[] = [];
    for (let x = 0; x < SIZE; x++) row.push(Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)));
    table.push(row);
  }
  return table;
})();

const ALPHA: number[] = [];
for (let i = 0; i < SIZE; i++) ALPHA.push(i === 0 ? 1 / Math.sqrt(2) : 1);

/** Compute the 64-bit DCT pHash of an image (any format sharp can decode). */
export async function computePHash(bytes: Uint8Array): Promise<string> {
  const { data } = await sharp(Buffer.from(bytes))
    .resize(SIZE, SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const g: number[][] = [];
  for (let y = 0; y < SIZE; y++) {
    const row: number[] = [];
    for (let x = 0; x < SIZE; x++) row.push(data[y * SIZE + x] ?? 0);
    g.push(row);
  }

  // 2D DCT: C[u][v] = alpha[u]*alpha[v]*sum_xy g[x][y]*cos_u*cos_v, keeping the
  // top-left LOW_FREQ x LOW_FREQ block only.
  const coefficients: number[] = [];
  for (let u = 0; u < LOW_FREQ; u++) {
    for (let v = 0; v < LOW_FREQ; v++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) {
        const cosV = DCT_COS[v]?.[y] ?? 0;
        for (let x = 0; x < SIZE; x++) {
          sum += (g[y]?.[x] ?? 0) * (DCT_COS[u]?.[x] ?? 0) * cosV;
        }
      }
      coefficients.push((ALPHA[u] as number) * (ALPHA[v] as number) * sum);
    }
  }

  const median = medianOf(coefficients);
  let hex = "";
  for (let i = 0; i < BIT_COUNT; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) {
      if ((coefficients[i + b] as number) > median) nibble |= 1 << (3 - b);
    }
    hex += nibble.toString(16);
  }
  return hex;
}

/** Number of differing bits between two 64-bit hex phashes. */
export function hammingDistance(a: string, b: string): number {
  let distance = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = parseInt(a[i] as string, 16) ^ parseInt(b[i] as string, 16);
    distance += POPCOUNT[x] as number;
  }
  // Longer hashes would have more bits; treat extra hex digits as differences.
  distance += Math.abs(a.length - b.length) * 4;
  return distance;
}

const POPCOUNT = (() => {
  const table = new Array<number>(16).fill(0);
  for (let i = 0; i < 16; i++) table[i] = (i & 1) + (table[i >> 1] as number);
  return table;
})();

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}