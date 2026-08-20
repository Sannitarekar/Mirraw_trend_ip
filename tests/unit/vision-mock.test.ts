import { test } from "node:test";
import assert from "node:assert/strict";
import { MockVisionProvider } from "../../src/vision/mock.ts";
import { ATTRIBUTE_KEYS } from "../../src/vision/types.ts";
import { validateTrendAttributes } from "../../src/vision/validation.ts";

const provider = new MockVisionProvider();

test("mock provider returns stable attributes for identical bytes", async () => {
  const bytes = new TextEncoder().encode("same-image-bytes");
  const a = await provider.analyze({ id: "1", bytes, mimeType: "image/png" });
  const b = await provider.analyze({ id: "2", bytes, mimeType: "image/png" });
  assert.deepEqual(a, b, "attributes are a deterministic function of the image");
});

test("mock provider output always passes validation", async () => {
  const bytes = new TextEncoder().encode("image-1");
  const attrs = await provider.analyze({ id: "x", bytes, mimeType: "image/png" });
  const validated = validateTrendAttributes(attrs);
  for (const key of ATTRIBUTE_KEYS) {
    assert.ok(key in validated, `key ${key} present`);
  }
  assert.ok(Array.isArray(validated.color_palette));
});

test("different images generally produce different attributes", async () => {
  const a = await provider.analyze({ id: "a", bytes: new TextEncoder().encode("img-a"), mimeType: "image/png" });
  const b = await provider.analyze({ id: "b", bytes: new TextEncoder().encode("img-b"), mimeType: "image/png" });
  assert.notDeepEqual(a, b);
});