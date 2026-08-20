import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { HttpError, retryWithBackoff } from "./retry.ts";

export interface DownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  attempts?: number;
}

/**
 * Download an image as bytes.
 *
 * Supports http(s) URLs (real collectors) and file:// URLs (local demo
 * fixtures so the full download->store->key flow runs without a network).
 * Retries transient failures with exponential backoff; caps payload size so
 * a poisoned URL cannot exhaust memory.
 */
export async function downloadImage(
  url: string,
  options: DownloadOptions = {},
): Promise<{ data: Buffer; contentType: string | null }> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;

  return retryWithBackoff(
    async () => {
      if (url.startsWith("file://")) {
        const filePath = fileURLToPath(url);
        const data = await readFile(filePath);
        if (data.length > maxBytes) {
          throw new HttpError(`file exceeds maxBytes: ${url}`, 413);
        }
        return { data, contentType: guessContentType(filePath) };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new HttpError(`GET ${url} -> ${response.status} ${response.statusText}`, response.status);
        }
        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > maxBytes) {
          throw new HttpError(`content-length exceeds maxBytes: ${url}`, 413);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) {
          throw new HttpError(`downloaded body exceeds maxBytes: ${url}`, 413);
        }
        return { data: buffer, contentType: response.headers.get("content-type") };
      } finally {
        clearTimeout(timer);
      }
    },
    {
      attempts: options.attempts ?? 3,
      baseDelayMs: 1000,
      maxDelayMs: 15000,
      shouldRetry: (error) => !(error instanceof HttpError && error.status < 500 && error.status !== 429),
    },
  );
}

function guessContentType(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return null;
}