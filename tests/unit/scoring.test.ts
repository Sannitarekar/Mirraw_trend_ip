import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateTrendScore,
  completenessScore,
  recencyScore,
  saveScore,
  shouldDiscard,
  unknownCount,
} from "../../src/scoring/index.ts";
import { sourceAuthority } from "../../src/scoring/authority.ts";
import type { TrendAttributesLike } from "../../src/scoring/types.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const fullAttrs: TrendAttributesLike = {
  garment_type: "saree",
  color_palette: ["ivory", "gold"],
  pattern: "floral",
  fabric_texture: "silk",
  embellishment: "zari",
  silhouette: "A-line",
  occasion: "wedding",
  neckline: "round",
  sleeve_style: "sleeveless",
  trend_season: "summer 2026",
};

test("saveScore normalises against SAVE_COUNT_REFERENCE_MAX (40% weight)", () => {
  assert.equal(saveScore(0), 0);
  assert.equal(saveScore(5000), 40);
  assert.equal(saveScore(100_000), 40); // capped
  assert.equal(saveScore(2500), 20);
});

test("recencyScore decays linearly over RECENCY_WINDOW_DAYS (30% weight)", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  assert.equal(recencyScore(new Date("2026-08-19T12:00:00Z"), now), 30);
  assert.equal(recencyScore(new Date("2026-08-12T12:00:00Z"), now), 0); // exactly 7 days
  assert.equal(recencyScore(new Date("2026-08-01T12:00:00Z"), now), 0); // older
  assert.equal(recencyScore(new Date("2026-08-16T00:00:00Z"), now), 15); // half window (3.5 days)
});

test("sourceAuthority maps editorial, social and scraped sources", () => {
  for (const s of ["vogue", "filmfare", "fdci-lakme"]) assert.equal(sourceAuthority(s), 1.0, s);
  for (const s of ["pinterest", "instagram"]) assert.equal(sourceAuthority(s), 0.8, s);
  for (const s of ["nykaa", "myntra", "unknown-source"]) assert.equal(sourceAuthority(s), 0.5, s);
});

test("authorityScore scales the coefficient to the 20% weight", () => {
  assert.equal(calculateTrendScore({ saveCount: 0, collectedAt: new Date(), source: "vogue", attributes: fullAttrs }).authority, 20);
  assert.equal(calculateTrendScore({ saveCount: 0, collectedAt: new Date(), source: "pinterest", attributes: fullAttrs }).authority, 16);
  assert.equal(calculateTrendScore({ saveCount: 0, collectedAt: new Date(), source: "nykaa", attributes: fullAttrs }).authority, 10);
});

test("unknownCount counts only truly unknown values", () => {
  const partial: TrendAttributesLike = { ...fullAttrs, pattern: "unknown", occasion: "  unknown  ", color_palette: [] };
  assert.equal(unknownCount(partial), 3);
});

test("completenessScore is 0 when more than 3 attributes are unknown", () => {
  const tooVague: TrendAttributesLike = {
    ...fullAttrs,
    garment_type: "unknown",
    pattern: "unknown",
    fabric_texture: "unknown",
    silhouette: "unknown",
  };
  assert.equal(unknownCount(tooVague), 4);
  assert.equal(completenessScore(tooVague), 0);
  assert.equal(completenessScore(fullAttrs), 10);
});

test("calculateTrendScore composites the four weighted signals", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const score = calculateTrendScore({
    saveCount: 5000,
    collectedAt: now,
    source: "vogue",
    attributes: fullAttrs,
    now,
  });
  assert.deepEqual(
    { saves: score.saves, recency: score.recency, authority: score.authority, completeness: score.completeness },
    { saves: 40, recency: 30, authority: 20, completeness: 10 },
  );
  assert.equal(score.total, 100);
  assert.equal(score.knownCount, 10);
  assert.equal(score.unknownCount, 0);
});

test("a low-signal image scores near zero", () => {
  const now = new Date("2026-08-19T12:00:00Z");
  const stale: TrendAttributesLike = {
    ...fullAttrs,
    garment_type: "unknown",
    pattern: "unknown",
    fabric_texture: "unknown",
    silhouette: "unknown",
  };
  const score = calculateTrendScore({
    saveCount: 0,
    collectedAt: new Date("2026-08-01T12:00:00Z"),
    source: "nykaa",
    attributes: stale,
    now,
  });
  assert.equal(score.total, 10); // authority only (completeness 0, saves 0, recency 0)
  assert.ok(shouldDiscard(score.total));
});

test("shouldDiscard respects TREND_SCORE_DISCARD_THRESHOLD", () => {
  assert.equal(shouldDiscard(19.9), true);
  assert.equal(shouldDiscard(20), false);
  assert.equal(shouldDiscard(99), false);
});