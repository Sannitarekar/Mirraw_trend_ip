import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisionJson, validateTrendAttributes } from "../../src/vision/validation.ts";
import { UNKNOWN } from "../../src/vision/types.ts";

test("valid JSON parses into clean attributes", () => {
  const raw = JSON.stringify({
    garment_type: "lehenga",
    color_palette: ["ivory", "gold"],
    pattern: "floral",
    fabric_texture: "silk",
    embellishment: "zari",
    silhouette: "A-line",
    occasion: "wedding",
    neckline: "round",
    sleeve_style: "sleeveless",
    trend_season: "summer 2026",
  });
  const attrs = parseVisionJson(raw);
  assert.equal(attrs.garment_type, "lehenga");
  assert.deepEqual(attrs.color_palette, ["ivory", "gold"]);
  assert.equal(attrs.trend_season, "summer 2026");
});

test("malformed JSON throws (never silently succeeds)", () => {
  assert.throws(() => parseVisionJson("{not json"), /not valid JSON/);
});

test("non-object input becomes all 'unknown'", () => {
  const attrs = validateTrendAttributes("hello");
  assert.equal(attrs.garment_type, UNKNOWN);
  assert.deepEqual(attrs.color_palette, [UNKNOWN]);
  assert.equal(attrs.occasion, UNKNOWN);
});

test("missing and empty attributes degrade to 'unknown'", () => {
  const attrs = validateTrendAttributes({ garment_type: "", color_palette: [] });
  assert.equal(attrs.garment_type, UNKNOWN);
  assert.deepEqual(attrs.color_palette, [UNKNOWN]);
  assert.equal(attrs.pattern, UNKNOWN);
});

test("non-string values degrade to 'unknown' instead of crashing", () => {
  const attrs = validateTrendAttributes({
    garment_type: 42,
    pattern: { nested: true },
    occasion: null,
    color_palette: "not-an-array",
  });
  assert.equal(attrs.garment_type, UNKNOWN);
  assert.equal(attrs.pattern, UNKNOWN);
  assert.equal(attrs.occasion, UNKNOWN);
  assert.deepEqual(attrs.color_palette, [UNKNOWN]);
});

test("strings are capped at the varchar(50) column width", () => {
  const long = "x".repeat(200);
  const attrs = validateTrendAttributes({ garment_type: long });
  assert.equal(attrs.garment_type.length, 50);
});

test("unknown keys from the model are dropped", () => {
  const attrs = validateTrendAttributes({
    garment_type: "saree",
    malicious_key: "drop me",
    extra: 1,
  });
  assert.equal("malicious_key" in attrs, false);
  assert.equal("extra" in attrs, false);
});

test("color_palette entries are trimmed and emptied entries removed", () => {
  const attrs = validateTrendAttributes({ color_palette: [" gold ", "", "  ivory  "] });
  assert.deepEqual(attrs.color_palette, ["gold", "ivory"]);
});