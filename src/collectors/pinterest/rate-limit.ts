import { performance } from "node:perf_hooks";

/**
 * Sliding-window rate limiter.
 *
 * Pinterest API v5 allows 10 requests/second (spec section 6.1). This
 * serializes calls so the client never exceeds the configured rate, even
 * across concurrent pagination loops.
 *
 * Uses performance.now() (monotonic, high-resolution) so scheduling and
 * measurement share one clock — Date.now() can be coarse and NTP-adjusted on
 * Windows, which caused measured gaps to dip below the configured interval.
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private nextAllowedAt = 0;

  constructor(requestsPerSecond: number) {
    if (requestsPerSecond <= 0) throw new Error("requestsPerSecond must be positive");
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  /** Wait until the next slot is available, then run fn. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const now = performance.now();
    const waitMs = Math.max(0, this.nextAllowedAt - now);
    // Math.ceil: setTimeout truncates fractional delays, which could otherwise
    // let the window slip a fraction of a millisecond early.
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitMs)));
    // Anchor the next window to the moment fn actually starts, not to the
    // start of this run() (the sleep above shifts execution later).
    const slotStart = performance.now();
    this.nextAllowedAt = Math.max(slotStart, this.nextAllowedAt) + this.minIntervalMs;
    return fn();
  }
}