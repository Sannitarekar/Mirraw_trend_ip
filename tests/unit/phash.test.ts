import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { computePHash, hammingDistance } from "../../src/dedup/phash.ts";
import { selectDuplicatesToDiscard } from "../../src/dedup/index.ts";
import type { ScoredImage } from "../../src/dedup/index.ts";

async function png(color: { r: number; g: number; b: number }, size = 64): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

test("computePHash returns a 64-bit hex hash, deterministic per image", async () => {
  const a = await png({ r: 120, g: 60, b: 220 });
  const b = await png({ r: 120, g: 60, b: 220 });
  const ha = await computePHash(a);
  const hb = await computePHash(b);
  assert.match(ha, /^[0-9a-f]{16}$/);
  assert.equal(ha, hb);
});

test("visually identical images hash to 0 distance", async () => {
  const a = await png({ r: 120, g: 60, b: 220 });
  const b = await png({ r: 120, g: 60, b: 220 }, 128); // different resolution
  const ha = await computePHash(a);
  const hb = await computePHash(b);
  assert.equal(hammingDistance(ha, hb), 0);
});

test("very different images have a large hamming distance", async () => {
  const white = await png({ r: 255, g: 255, b: 255 });
  const black = await png({ r: 0, g: 0, b: 0 });
  const distance = hammingDistance(await computePHash(white), await computePHash(black));
  assert.ok(distance > 20, `expected far apart, got ${distance}`);
});

test("slightly different images are close (near-duplicates)", async () => {
  const base = await png({ r: 120, g: 60, b: 220 });
  const shifted = await sharp(Buffer.from(base))
    .extract({ left: 0, top: 0, width: 48, height: 64 })
    .toBuffer();
  const distance = hammingDistance(await computePHash(base), await computePHash(new Uint8Array(shifted)));
  assert.ok(distance <= 10, `expected near-duplicate, got distance ${distance}`);
});

test("hammingDistance counts differing bits", () => {
  assert.equal(hammingDistance("0000", "0000"), 0);
  assert.equal(hammingDistance("0000", "0001"), 1);
  assert.equal(hammingDistance("0000", "ffff"), 16);
  assert.equal(hammingDistance("ff00", "0ff0"), 8);
});

test("selectDuplicatesToDiscard keeps the higher-scored image per group", () => {
  const images: ScoredImage[] = [
    { id: "a", phash: "0000000000000000", trendScore: 40 },
    { id: "b", phash: "0000000000000001", trendScore: 90 }, // near-dup of a, higher score
    { id: "c", phash: "ffffffffffffffff", trendScore: 60 },
  ];
  const discard = selectDuplicatesToDiscard(images, 10);
  assert.deepEqual([...discard].sort(), ["a"]);
});

test("images without a phash are never deduplicated", () => {
  const images: ScoredImage[] = [
    { id: "a", phash: "0000000000000000", trendScore: 40 },
    { id: "b", phash: null, trendScore: 90 },
  ];
  const discard = selectDuplicatesToDiscard(images, 10);
  assert.deepEqual(discard, []);
});

test("an image with no near-duplicate is kept", () => {
  const images: ScoredImage[] = [
    { id: "a", phash: "0000000000000000", trendScore: 40 },
    { id: "b", phash: "ffffffffffffffff", trendScore: 90 },
  ];
  const discard = selectDuplicatesToDiscard(images, 5);
  assert.deepEqual(discard, []);
});