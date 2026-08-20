# Interview Notes

Talking points and decision log for presenting this build in the Round 2 interview.
Read together with [README.md](README.md) (how it runs) and
[ASSUMPTIONS.md](ASSUMPTIONS.md) (product assumptions).

## Elevator pitch

> TIP is an offline-runnable pipeline that collects fashion images from four kinds
> of sources, runs them through vision AI to extract attributes, scores them on a
> transparent 40/30/20/10 model, removes near-duplicates with a perceptual hash, and
> serves the daily trend feed over a REST API. Every external system has a mock
> provider, so a reviewer can run the whole thing — collect → analyze → score →
> feed — in seconds with zero credentials.

## Architecture at a glance

```
Instagram CSV ─┐
Pinterest API  ─┤─► raw_trend_images ─► Vision AI ─► attributes + pHash
Scraper sites  ─┘        │              (mock/Claude)      │
                         │                                 ▼
                    images in obj-store           trend_score computed
                                                      │
                                                     ▼
                                         pHash dedup ─► promote top-200 ─► TREND_FEED ─► REST API
                                                                                │
                                                                         usage tracking (3/month)
```

- **One interface, swappable implementations.** Storage (local/MinIO/S3), vision
  (mock/Claude), Pinterest (mock/API v5), Slack (mock/webhook), scraping
  (fixture/live). This is the single idea that makes the demo both runnable and
  production-shaped.
- **Stateful status columns, not a job queue.** Each row moves
  `collected → analyzed → scored/discarded → promoted`. Steps are idempotent and
  re-runnable, which is what lets a daily cron just "process the new increment".
- **Fastify + PostgreSQL schema** (`src/db/schema.sql`) for the API; PGlite embeds
  the same schema for the demo.

## Key decisions and why

| Decision | Choice | Why |
|----------|--------|-----|
| Runtime | Node.js 24 + Fastify | Type-safe, single language across pipeline and API, fast to bootstrap; `node --test` built in |
| Database | Postgres schema, PGlite for demo | Reviewer runs zero infrastructure; production path is a real PG connection string |
| Vision | Mock default, Claude opt-in | Demo is deterministic and free; real provider is one env flag |
| Popularity signal | `save_count` from pin metrics | Pinterest API v5 exposes it; scraped/CSV items default to 0 |
| Dedup | pHash (DCT) | Same image arrives under many URLs; pHash catches visual duplicates URL dedup misses |
| Scheduling | n8n workflows + local CLI runner | Matches the brief's "airflow-like" mention; n8n JSONs are importable and the runner is testable |
| Usage cap | Row lock + monthly counter | Concurrency-safe 3-uses/month (verified by a parallel test) |

## Trade-offs to be ready to defend

1. **Mock vision understands nothing.** The demo's attribute extraction is a
   deterministic fixture seeded to look plausible. Real Claude Vision returns the
   same schema, so nothing downstream changes. This is the biggest honesty caveat —
   lead with it.
2. **Mock Pinterest is synthetic.** Pins are seeded from the same 12 fixture images;
   real API v5 needs OAuth and is rate-limited (limiter included).
3. **pHash vs color.** Different-colored but structurally identical outfits hash as
   near-duplicates. Intended for "same look" dedup; tune the threshold down to 0 if
   you want only exact matches.
4. **Score weights are guesses.** 40/30/20/10 with a linear 7-day decay. All are env
   tunables; the model is deliberately transparent over "magic".
5. **Scraping is fragile by nature** (site markup changes). The fixture/live switch
   and per-source failure isolation keep that risk contained.

## What each test proves

- `tests/unit/scoring.test.ts` — weights, saturation, discard threshold, decay.
- `tests/unit/phash.test.ts` — distinct images hash far apart, identical hash equal,
  tolerance of small edits (resize/encode).
- `tests/integration/analysis.test.ts` — batch analysis persists attributes, handles
  missing images, normalizes bad model output.
- `tests/integration/scoring-service.test.ts` — score → dedup → promote → Slack,
  incl. feed-date uniqueness.
- `tests/integration/api.test.ts` — feed query/filter/pagination, static files, and
  the 3-uses/month cap under 6 concurrent requests.
- `tests/unit/rate-limit.test.ts` — Pinterest limiter never fires below `minInterval`.

93 tests, `npm test`, plus `npm run typecheck`.

## How to demo it live

1. `npm run demo` — wipes `.data`, collects 70 looks, analyzes, scores, prints the
   promoted feed and the status breakdown.
2. `npm run api` — then `curl` the feed with filters and `POST /used` (3× ok, 4th →
   429). Images are served by `/files/*`.

## Follow-ups (what I'd build next)

- Moodboards API (explicitly out of scope).
- Exponential recency decay + A/B the weights.
- Backfill/audit for "use" events (save vs purchase vs click).
- Real Pinterest OAuth refresh + webhook-driven collection.
- K8s/EC2 deployment manifests for the pipeline runner + API (n8n JSONs reference a
  deploy-time path).