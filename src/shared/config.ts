import { z } from "zod";
import dotenv from "dotenv";

// Load .env into process.env (never overrides real environment variables).
// Skipped in test mode so tests stay hermetic.
if (process.env.NODE_ENV !== "test") {
  dotenv.config();
}

/**
 * Central environment configuration.
 *
 * All secrets and tunables come from environment variables (see .env.example).
 * Values are validated at startup so misconfiguration fails fast instead of
 * surfacing as confusing runtime errors later.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Database: leave DATABASE_URL empty (or prefix "pglite://") for the
  // embedded demo database; use a postgres:// URL for a real PostgreSQL.
  DATABASE_URL: z.string().optional().default(""),
  PGLITE_DATA_DIR: z.string().default(".data/pglite"),

  // Object storage
  STORAGE_DRIVER: z.enum(["local", "minio", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().default("ap-south-1"),
  S3_BUCKET: z.string().default("mirraw-trend-images"),
  S3_ACCESS_KEY: z.string().optional().default(""),
  S3_SECRET_KEY: z.string().optional().default(""),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  CDN_BASE_URL: z.string().default("http://localhost:3000/files"),

  // Vision AI
  VISION_PROVIDER: z.enum(["mock", "claude"]).default("mock"),
  VISION_MODEL: z.string().default("claude-sonnet-4"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_BASE_URL: z.string().default("https://api.anthropic.com"),

  // Pinterest
  PINTEREST_PROVIDER: z.enum(["mock", "api"]).default("mock"),
  PINTEREST_CLIENT_ID: z.string().optional().default(""),
  PINTEREST_CLIENT_SECRET: z.string().optional().default(""),
  PINTEREST_ACCESS_TOKEN: z.string().optional().default(""),
  PINTEREST_RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(10),

  // Web scrapers
  // fixture -> load local demo HTML pages (default, offline-safe)
  // live    -> scrape the real sites (needs network; may break as sites change)
  SCRAPER_MODE: z.enum(["fixture", "live"]).default("fixture"),

  // Slack
  SLACK_MODE: z.enum(["mock", "webhook"]).default("mock"),
  SLACK_WEBHOOK_URL: z.string().optional().default(""),
  SLACK_CHANNEL: z.string().default("#product-ai"),

  // Scoring
  TREND_SCORE_DISCARD_THRESHOLD: z.coerce.number().min(0).max(100).default(20),
  TREND_FEED_PROMOTE_LIMIT: z.coerce.number().int().positive().default(200),
  SAVE_COUNT_REFERENCE_MAX: z.coerce.number().positive().default(5000),
  RECENCY_WINDOW_DAYS: z.coerce.number().positive().default(7),
  SOURCE_AUTHORITY_VOGUE_FDCI: z.coerce.number().min(0).max(1).default(1.0),
  SOURCE_AUTHORITY_PINTEREST: z.coerce.number().min(0).max(1).default(0.8),
  SOURCE_AUTHORITY_SCRAPER: z.coerce.number().min(0).max(1).default(0.5),

  // Deduplication: max hamming distance (bits) to treat two phashes as the
  // same image. 0 = exact duplicates only.
  DEDUP_PHASH_DISTANCE_THRESHOLD: z.coerce.number().int().min(0).max(64).default(10),

  // Usage restriction
  MAX_USES_PER_IMAGE_PER_MONTH: z.coerce.number().int().positive().default(3),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadEnv(): Record<string, string | undefined> {
  if (process.env.NODE_ENV === "test") {
    return process.env as Record<string, string | undefined>;
  }
  return process.env as Record<string, string | undefined>;
}

let cached: AppConfig | null = null;

/** Load (and validate) configuration once per process. */
export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(loadEnv());
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset cached config (used by tests). */
export function resetConfig(): void {
  cached = null;
}