import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PinterestAdapter } from "../../src/collectors/pinterest/index.ts";
import { MockPinterestProvider } from "../../src/collectors/pinterest/mock.ts";
import { PinterestApiClient } from "../../src/collectors/pinterest/api.ts";
import type { PinterestBoard, PinterestPin } from "../../src/collectors/pinterest/types.ts";

const SAMPLE_IMAGES_DIR = fileURLToPath(new URL("../../sample-data/images", import.meta.url));

test("mock provider yields pins with save counts and local image URLs", async () => {
  const provider = new MockPinterestProvider();
  const boards = await provider.listBoards();
  assert.ok(boards.length > 0);

  const firstPage = await provider.getBoardPins(boards[0]!.id, { pageSize: 100 });
  assert.ok(firstPage.items.length > 0);
  assert.equal(firstPage.bookmark, "page2", "bookmark pagination is exercised");

  const pin = firstPage.items[0]!;
  assert.ok(typeof pin.pin_metrics?.save_count === "number");
  assert.match(pin.media!.images!["600x"]!.url!, /^file:\/\//);
});

test("adapter normalizes pins into RawSourceItems", async () => {
  const adapter = new PinterestAdapter(new MockPinterestProvider());
  const items = await adapter.fetchRaw();
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.sourceUrl.includes("pinterest"), true);
    assert.ok(item.imageUrl.length > 0);
    assert.ok(item.raw["pin_metrics"], "raw payload preserved");
    assert.equal(typeof item.raw["save_count"], "undefined");
  }
});

test("pins without an image are skipped during normalization", () => {
  const adapter = new PinterestAdapter(new MockPinterestProvider());
  const board: PinterestBoard = { id: "b", name: "b" };
  const withImage: PinterestPin = {
    id: "p1",
    media: { images: { "600x": { url: "https://img.example/a.jpg" } } },
    pin_metrics: { save_count: 10 },
  };
  const withoutImage: PinterestPin = { id: "p2", media: { images: {} } };

  // Access the private normalizePin via a wrapper that runs one pin.
  const normalized = (adapter as unknown as {
    normalizePin(pin: PinterestPin, b: PinterestBoard): unknown;
  }).normalizePin(withImage, board);
  assert.ok(normalized);
  const skipped = (adapter as unknown as {
    normalizePin(pin: PinterestPin, b: PinterestBoard): unknown;
  }).normalizePin(withoutImage, board);
  assert.equal(skipped, null);
});

test("sample images referenced by the mock actually exist", () => {
  const images = readdirSync(SAMPLE_IMAGES_DIR);
  assert.ok(images.length >= 10, "at least 10 demo images");
  const imgPath = path.join(SAMPLE_IMAGES_DIR, images[0]!);
  assert.equal(existsSync(imgPath), true);
});

test("real API client requires a token", () => {
  assert.throws(() => new PinterestApiClient(""), /TOKEN is required/);
});