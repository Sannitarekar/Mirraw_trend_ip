import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { RateLimiter } from "../../src/collectors/pinterest/rate-limit.ts";

test("rate limiter enforces max requests per second", async () => {
  const limiter = new RateLimiter(10); // 100ms between calls
  const timestamps: number[] = [];
  for (let i = 0; i < 5; i++) {
    await limiter.run(async () => timestamps.push(performance.now()));
  }
  for (let i = 1; i < timestamps.length; i++) {
    const gap = timestamps[i]! - timestamps[i - 1]!;
    // Allow a 1ms tolerance for OS timer resolution (setTimeout may fire a
    // fraction of a millisecond ahead of its nominal delay on Windows).
    assert.ok(gap >= 99, `gap ${gap}ms must respect the rate window`);
  }
});

test("rate limiter allows immediate first call", async () => {
  const limiter = new RateLimiter(10);
  const start = performance.now();
  await limiter.run(async () => undefined);
  assert.ok(performance.now() - start < 50, "first call should not wait");
});

test("rejects non-positive rates", () => {
  assert.throws(() => new RateLimiter(0), /positive/);
});