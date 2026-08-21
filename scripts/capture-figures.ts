import { chromium } from "playwright";
import sharp from "sharp";
import { mkdirSync, readdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildServer } from "../src/api/server.ts";
import { openDatabase } from "../src/db/index.ts";
import { createStorage } from "../src/storage/index.ts";

/**
 * Captures real output artifacts for the submission document:
 *  - fig-garments.png   contact sheet of the 12 fixture garments
 *  - fig-feed.png       trend feed JSON (pretty-printed, real data)
 *  - fig-filtered.png   filtered feed (garment_type=lehenga)
 *  - fig-dress.png      an actual promoted image as served by the API
 *   node scripts/capture-figures.ts
 */

const outDir = path.join(process.cwd(), "submission-assets");
mkdirSync(outDir, { recursive: true });

// ---------- 1. Contact sheet of the fixture garments ----------
const imagesDir = path.join(process.cwd(), "sample-data", "images");
const files = readdirSync(imagesDir).sort();
const CW = 150;
const CH = 200;
const COLS = 6;
const cells: sharp.OverlayOptions[] = [];
for (const [i, f] of files.entries()) {
  const buf = await sharp(path.join(imagesDir, f)).resize(CW, CH).png().toBuffer();
  cells.push({ input: buf, left: (i % COLS) * CW, top: Math.floor(i / COLS) * CH });
}
await sharp({
  create: { width: COLS * CW, height: Math.ceil(files.length / COLS) * CH, channels: 3, background: "#ffffff" },
})
  .composite(cells)
  .png()
  .toFile(path.join(outDir, "fig-garments.png"));
console.log("fig-garments.png");

// ---------- 2. Boot the real API against the demo database ----------
const db = await openDatabase();
const storage = createStorage();
const server = await buildServer({ db, storage });
await server.listen({ port: 3000, host: "127.0.0.1" });
const base = "http://127.0.0.1:3000";

async function shotJson(apiPath: string, outFile: string): Promise<void> {
  const res = await fetch(`${base}${apiPath}`);
  const json = (await res.json()) as unknown;
  const pretty = JSON.stringify(json, null, 2);
  const viewer = `<html><head><meta charset="utf-8"><style>
      body { margin:0; font-family: Consolas, 'Courier New', monospace; background:#fff; }
      .bar { padding:10px 16px; background:#1c2333; color:#fff; font-size:13px; font-family:'Segoe UI',sans-serif; }
      .bar b { color:#f0c34e; font-weight:600; margin-right:8px; }
      pre { margin:14px 18px; font-size:12.5px; line-height:1.5; color:#1c2333; white-space:pre-wrap; }
    </style></head><body>
      <div class="bar"><b>GET</b> ${apiPath}</div>
      <pre>${pretty.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
    </body></html>`;
  const tmp = path.join(outDir, "_shot.html");
  writeFileSync(tmp, viewer);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 780 }, deviceScaleFactor: 2 });
    await page.goto(`file:///${tmp.replaceAll("\\", "/")}`);
    await page.screenshot({ path: path.join(outDir, outFile) });
  } finally {
    await browser.close();
  }
  console.log(outFile);
}

await shotJson("/api/v1/trends/feed?date_from=2026-08-01&date_to=2026-08-31", "fig-feed.png");
await shotJson("/api/v1/trends/feed?garment_type=lehenga&min_score=50&date_from=2026-08-01&date_to=2026-08-31", "fig-filtered.png");

// ---------- 3. An actual promoted image, straight from storage ----------
type FeedImg = { image_s3_url: string };
const feedRes = await fetch(`${base}/api/v1/trends/feed?date_from=2026-08-01&date_to=2026-08-31&min_score=60&limit=1`);
const feed = (await feedRes.json()) as { images: FeedImg[] };
const imgUrl = new URL(feed.images[0].image_s3_url);
const key = decodeURIComponent(imgUrl.pathname.replace("/files/", ""));
copyFileSync(path.join(process.cwd(), ".data", "storage", key), path.join(outDir, "fig-dress.png"));
console.log("fig-dress.png");

// ---------- cleanup ----------
await server.close();
await db.close();
rmSync(path.join(outDir, "_shot.html"), { force: true });
console.log("done");