import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, retryWithBackoff } from "../../src/collectors/common/retry.ts";

test("succeeds on first attempt without retrying", async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("retries transient failures then succeeds", async () => {
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      calls++;
      if (calls < 3) throw new Error("flaky");
      return "recovered";
    },
    { attempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
  );
  assert.equal(result, "recovered");
  assert.equal(calls, 3);
});

test("gives up after max attempts", async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls++;
        throw new Error("always fails");
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
    ),
    /always fails/,
  );
  assert.equal(calls, 3);
});

test("does not retry permanent (4xx) failures when shouldRetry is set", async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls++;
        throw new HttpError("bad request", 400);
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 5, shouldRetry: (e) => !(e instanceof HttpError && e.status < 500) },
    ),
    /bad request/,
  );
  assert.equal(calls, 1, "a 400 must not be retried");
});

test("does retry 429 rate limits", async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(
      async () => {
        calls++;
        throw new HttpError("rate limited", 429);
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 5, shouldRetry: (e) => !(e instanceof HttpError && e.status < 500 && e.status !== 429) },
    ),
    /rate limited/,
  );
  assert.equal(calls, 3, "a 429 must be retried");
});

test("calls onRetry with attempt info", async () => {
  const attempts: number[] = [];
  let calls = 0;
  await retryWithBackoff(
    async () => {
      calls++;
      if (calls < 2) throw new Error("x");
      return true;
    },
    {
      attempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      onRetry: (attempt) => attempts.push(attempt),
    },
  );
  assert.deepEqual(attempts, [1]);
});