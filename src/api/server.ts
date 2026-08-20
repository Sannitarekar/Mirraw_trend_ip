import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { DbClient } from "../db/types.ts";
import type { AppConfig } from "../shared/config.ts";
import { getConfig } from "../shared/config.ts";
import type { ObjectStorage } from "../storage/types.ts";
import { queryTrendFeed, recordUsage } from "./trends.ts";

export interface TrendApiOptions {
  db: DbClient;
  storage: ObjectStorage;
  config?: AppConfig;
}

const feedQuerySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  garment_type: z.string().optional(),
  occasion: z.string().optional(),
  min_score: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * REST API consumed exclusively by the Image Generation Pipeline
 * (spec section 10, base URL /api/v1/trends).
 *
 *   GET  /api/v1/trends/feed          paginated top-scored feed
 *   POST /api/v1/trends/:id/used      record a use (max 3/image/month)
 *   GET  /files/*                     demo CDN serving object storage
 */
export async function buildServer(options: TrendApiOptions): Promise<FastifyInstance> {
  const config = options.config ?? getConfig();
  const server = Fastify({ logger: false });

  server.get("/health", async () => ({ status: "ok" }));

  server.get("/api/v1/trends/feed", async (request, reply) => {
    const parsed = feedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid query parameters", issues: parsed.error.issues });
    }
    const q = parsed.data;
    const filters: import("./trends.ts").FeedFilters = {};
    if (q.date_from !== undefined) filters.dateFrom = q.date_from;
    if (q.date_to !== undefined) filters.dateTo = q.date_to;
    if (q.garment_type !== undefined) filters.garmentType = q.garment_type;
    if (q.occasion !== undefined) filters.occasion = q.occasion;
    if (q.min_score !== undefined) filters.minScore = q.min_score;
    if (q.limit !== undefined) filters.limit = q.limit;
    if (q.page !== undefined) filters.page = q.page;
    const result = await queryTrendFeed(options.db, config, filters);
    return reply.send(result);
  });

  server.post("/api/v1/trends/:id/used", async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid feed entry id" });
    }
    const result = await recordUsage(options.db, parsed.data.id, config);
    if (!result.ok) {
      return reply.code(result.status).send({ error: result.reason });
    }
    return reply.code(201).send({ usage_count: result.usageCount });
  });

  server.get("/files/*", async (request, reply) => {
    const key = (request.params as { "*": string })["*"];
    if (!key) return reply.code(404).send({ error: "not found" });
    try {
      const bytes = await options.storage.get(key);
      reply.type(contentTypeFor(key)).header("content-length", String(bytes.length));
      return reply.send(Buffer.from(bytes));
    } catch {
      return reply.code(404).send({ error: "not found" });
    }
  });

  return server;
}

function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "html":
      return "text/html; charset=utf-8";
    default:
      return "image/jpeg";
  }
}