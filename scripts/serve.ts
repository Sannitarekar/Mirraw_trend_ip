import { openDatabase } from "../src/db/index.ts";
import { createStorage } from "../src/storage/index.ts";
import { buildServer } from "../src/api/server.ts";
import { getConfig } from "../src/shared/config.ts";
import { getLogger } from "../src/shared/logger.ts";

/**
 * Boots the Trend Feed API (spec section 10).
 *   node scripts/serve.ts   (PORT env var, default 3000)
 */
const cfg = getConfig();
const db = await openDatabase();
const storage = createStorage();
const server = await buildServer({ db, storage });

const port = Number(process.env.PORT ?? 3000);
await server.listen({ port, host: "0.0.0.0" });
getLogger().info("api: listening", { port, cdnBase: cfg.CDN_BASE_URL });