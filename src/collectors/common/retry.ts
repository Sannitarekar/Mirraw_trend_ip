/**
 * Retry helper with exponential backoff + full jitter.
 *
 * Used wherever the spec demands retries: Pinterest rate limits, image
 * downloads, vision API timeouts. Jitter avoids thundering-herd retries when
 * many workers fail at once. A "shouldRetry" predicate lets callers avoid
 * retrying permanent failures (e.g. 4xx validation errors).
 */
export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "shouldRetry" | "onRetry">> = {
  attempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  factor: 2,
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs, factor, shouldRetry, onRetry } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (shouldRetry && !shouldRetry(error)) throw error;
      if (attempt === attempts) break;
      const delay = Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);
      // Full jitter: random delay between 0 and the computed backoff.
      const jittered = Math.floor(Math.random() * delay);
      onRetry?.(attempt, error, jittered);
      await new Promise((resolve) => setTimeout(resolve, jittered));
    }
  }
  throw lastError;
}

/** Convenience for non-retryable errors that carry an HTTP status. */
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}