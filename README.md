# Trend Intelligence Platform (TIP)

Automated fashion trend discovery for Mirraw: collect looks from fashion sources, run
them through vision AI, score and deduplicate them, and serve the daily trend feed.

This is a **zero-network demo build** — every external system (Pinterest, Instagram,
scraping, vision AI, Slack) has a deterministic mock provider so the whole pipeline
runs offline. Swap in the real providers via environment variables (see
[.env.example](.env.example)).

## Quick start (demo)

```bash
npm install          # Playwright will fetch Chromium on first run
npx playwright install chromium   # only if not already installed
npm run demo         # wipes .data, collects 70 looks, analyzes, scores, promotes
npm run api          # serves the feed API on http://localhost:3000
```

Then:

```bash
curl "http://localhost:3000/api/v1/trends/feed?date_from=2026-08-01&date_to=2026-08-31"
curl "http://localhost:3000/api/v1/trends/feed?garment_type=lehenga&min_score=50"
curl -X POST http://localhost:3000/api/v1/trends/<feed-id>/used \
     -H "Content-Type: application/json" -d '{}'
```

The demo takes about 3 seconds: 70 images are collected, analyzed, scored, 58
near-duplicates removed by pHash, and 12 unique looks promoted to `TREND_FEED`.

## Pipeline

```
collect → analyze → score (+ dedup) → promote → API
```

| Step | Command | What it does |
|------|---------|--------------|
| Collect | `npm run collect` | Instagram CSV, Pinterest pins, fashion-site scrapers → `raw_trend_images` + images in object storage |
| Analyze | `npm run analyze` | Vision AI reads each image → attributes, color palette, pHash |
| Score | `npm run score` | Scores every analyzed image, discards weak ones, pHash-dedups, promotes the daily top-200, posts a Slack summary |
| All | `npm run pipeline` | collect + analyze + score in one run |
| Serve | `npm run api` | Fastify server: trend feed + usage tracking + `/files/*` static images |

Each step is idempotent and re-runnable — rows carry status flags
(`collected` → `analyzed` → `scored`/`discarded` → `promoted`), so a daily run only
processes the new increment.

### Collectors (all mockable)

| Source | Provider | Mock (default) | Live |
|--------|----------|----------------|------|
| Pinterest | `PINTEREST_PROVIDER` | seeded synthetic pins (`mock`) | `api` — Pinterest API v5 with rate limiter |
| Instagram | — | local CSV (`sample-data/instagram`) | real CSV export in production |
| Vogue / Filmfare / FDCI-Lakmé / Nykaa | `SCRAPER_MODE` | `fixture` — local HTML files | `live` — headless Chromium |

### Vision AI

`VISION_PROVIDER=mock` (default) uses a deterministic local classifier so the demo
never calls out to a paid API. Set `VISION_PROVIDER=claude` and `ANTHROPIC_API_KEY`
to use real Claude Vision (`claude-sonnet-4`). Both providers return the same
normalized `VisionImageInput` schema.

### Scoring model

Trend score is a weighted sum (configurable via env):

| Component | Weight | Notes |
|-----------|--------|-------|
| Save popularity | 40% | `save_count` normalized against a reference max (5000) |
| Recency | 30% | linear decay over `RECENCY_WINDOW_DAYS` (7) |
| Source authority | 20% | Vogue/Filmfare/FDCI = 1.0, Pinterest/Instagram = 0.8, others = 0.5 |
| Completeness | 10% | hard 0 if fewer than 7 attributes known |

Images scoring below `TREND_SCORE_DISCARD_THRESHOLD` (20) are discarded.

### Deduplication

A perceptual hash (pHash) is computed during analysis. On scoring, images within a
hamming distance of `DEDUP_PHASH_DISTANCE_THRESHOLD` (10) of a higher-scored image
are marked as near-duplicates and excluded from the feed. The threshold is a
trade-off: 0 = exact duplicates only, higher = more aggressive visual grouping.

## API

Base URL: `http://localhost:3000` (override with `PORT`).

### `GET /api/v1/trends/feed`

Query params (all optional):

| Param | Default | Notes |
|-------|---------|-------|
| `date_from` | today − 7 days | `YYYY-MM-DD` |
| `date_to` | today | `YYYY-MM-DD` |
| `garment_type` | — | kurta, lehenga, saree, anarkali, sharara, coords, ... |
| `occasion` | — | wedding, party, festive, casual, daily wear, ... |
| `min_score` | 40 | lower bound on trend score |
| `limit` | 50 (max 200) | page size |
| `page` | 1 | 1-based page number |

```json
{
  "images": [
    {
      "id": "bcaa283c-340d-462d-bf7f-285cbad69802",
      "image_s3_url": "http://localhost:3000/files/pinterest/2026-08-19/b34b3e47.png",
      "attributes": { "garment_type": "lehenga", "occasion": "wedding", "colors": ["gold", "purple"], "embellishments": ["embroidery"] },
      "trend_score": 79.6,
      "source": "pinterest",
      "collected_at": "2026-08-19T18:53:32.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "has_more": false
}
```

### `POST /api/v1/trends/:id/used`

Records that a customer used (saved/bought) a trend image. Each image can be used at
most `MAX_USES_PER_IMAGE_PER_MONTH` (3) times per calendar month; the 4th call in the
same month returns `429`. The counter is protected by a `SELECT ... FOR UPDATE` row
lock so concurrent requests stay accurate.

### `GET /files/*`

Serves stored images (used as the `image_s3_url` in demo mode). In production this is
the CDN (`CDN_BASE_URL`).

## Testing

```bash
npm run typecheck        # tsc --noEmit
npm test                 # 93 unit + integration tests (Node test runner)
npm run test:unit
npm run test:integration
```

Tests run against PGlite (embedded Postgres, zero install). Integration tests cover
the scoring service, the promotion job, and the API (including a concurrency test
that verifies the 3-uses-per-month cap).

## Project layout

```
src/
  collectors/       Instagram CSV, Pinterest (mock + API v5), scraper framework
  vision/           mock + Claude providers, shared schema
  analysis/         batch analysis service, attribute normalization
  scoring/          scoring engine, promotion job (score → dedup → promote → Slack)
  dedup/            pHash (DCT-based) + near-duplicate selection
  api/              Fastify routes: feed, usage, static files
  pipeline-runner/  CLI (collect / analyze / score / all)
  db/               schema + PGlite / Postgres adapters
  storage/          object storage: local / MinIO / S3
  slack/            mock + webhook notifiers
  shared/           config (zod), logging
scripts/
  demo.ts           end-to-end demo (wipe → collect → analyze → score → feed)
  serve.ts          boots the API
  generate-sample-images.ts   regenerates the 12 demo fixture images
sample-data/        fixture images, Instagram CSV, scraper HTML
n8n/                importable workflow JSONs (daily + every-30-min crons)
tests/              unit/ and integration/ suites
```

## Scheduling with n8n

`n8n/` contains three importable workflows that call `node src/pipeline-runner/index.ts <step>`:

| Workflow | Schedule | Command |
|----------|----------|---------|
| `workflow-1-collection.json` | daily 02:00 IST | `collect` |
| `workflow-2-analysis.json` | every 30 min | `analyze` |
| `workflow-3-scoring.json` | daily 03:30 IST | `score` |

Scoring posts the daily summary to the configured Slack channel (`SLACK_CHANNEL`,
default `#product-ai`).

## Configuration

All knobs live in [.env.example](.env.example) and are validated by `src/shared/config.ts`.
Copy to `.env` and change any value. Real secrets (API keys, database credentials)
must never be committed.