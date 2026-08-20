import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalDiskStorage } from "../../src/storage/local-disk.ts";

const root = mkdtempSync(path.join(tmpdir(), "tip-storage-"));
const storage = new LocalDiskStorage(root, "http://localhost:3000/files");

test("put/get round-trip", async () => {
  const bytes = new TextEncoder().encode("fashion-image-bytes");
  const meta = await storage.put("images/2026/08/saree.jpg", bytes, "image/jpeg");
  assert.equal(meta.key, "images/2026/08/saree.jpg");
  assert.equal(meta.size, bytes.length);
  assert.equal(meta.contentType, "image/jpeg");

  const back = await storage.get("images/2026/08/saree.jpg");
  assert.equal(back.toString("utf8"), "fashion-image-bytes");
});

test("exists reflects written files", async () => {
  assert.equal(await storage.exists("images/2026/08/saree.jpg"), true);
  assert.equal(await storage.exists("images/2026/08/missing.jpg"), false);
});

test("publicUrl builds a CDN URL without double slashes", async () => {
  assert.equal(
    storage.publicUrl("images/2026/08/saree.jpg"),
    "http://localhost:3000/files/images/2026/08/saree.jpg",
  );
});

test("delete removes the object", async () => {
  await storage.put("tmp/delete-me.bin", new TextEncoder().encode("x"));
  assert.equal(await storage.exists("tmp/delete-me.bin"), true);
  await storage.delete("tmp/delete-me.bin");
  assert.equal(await storage.exists("tmp/delete-me.bin"), false);
});

test("path traversal keys stay inside the storage root", async () => {
  await storage.put("../../escape.bin", new TextEncoder().encode("nope"));
  // The ".." segments are stripped; the file must not escape the root.
  const outside = path.join(path.dirname(root), "escape.bin");
  assert.equal(existsSync(outside), false, "must not write outside the root");
  assert.equal(existsSync(path.join(root, "escape.bin")), true);
});