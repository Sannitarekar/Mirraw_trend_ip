# Assumptions

This document records the assumptions made while building the Trend Intelligence
Platform from the assignment brief, so reviewers can distinguish deliberate product
decisions from the parts that depend on unspecified details.

## Product assumptions

1. **"Trend score" is a weighted composite, not a single magic metric.** The brief
   listed save counts, collection-source authority, and manual curation. We combine:
   save popularity (40%) + recency (30%) + source authority (20%) + attribute
   completeness (10%). Weights are deliberately configurable because the brief did
   not pin them down.

2. **Save counts drive popularity.** `raw_metadata->pin_metrics->>'save_count'` is
   the popularity signal. Pinterest API v5 pins expose it directly; scraped and
   Instagram CSV items use 0 unless a source provides the field. The reference max
   (5000 saves) normalizes the score; 5000+ saves saturates the component.

3. **Recency is a linear 7-day decay.** The brief said "last 7 days of data matter
   most" but not how the decay curve looks. We use a linear falloff from 1.0 (today)
   to 0.0 (8 days old). A dashboard run can switch this to exponential without
   schema changes.

4. **A look is an image.** The brief uses "image" and "look" interchangeably, so one
   `raw_trend_images` row = one collected image + attributes. No separate entity
   joins multiple photos of the same outfit.

5. **Authority is per-source, not per-image.** Vogue / Filmfare / FDCI-Lakmé are the
   highest-authority sources (1.0), Pinterest / Instagram lower (0.8), the four
   scraper sites the lowest (0.5). Manual curation (described in the brief) is
   represented by the ability to override a score in the DB; the demo does not seed
   manual curations.

6. **Near-duplicate detection uses a perceptual hash (pHash).** Identical images may
   appear under different source URLs, so URL dedup alone is insufficient. pHash
   treats visually similar images (same composition) as duplicates; the distance
   threshold (10) is configurable. Color-different but structurally identical looks
   legitimately hash close — that is intended behavior for a "same look" filter.

7. **The trend feed shows the promoted daily top-200** (`TREND_FEED_PROMOTE_LIMIT`),
   queried with filters. The feed date is the scoring run's date; one run per day is
   assumed (enforced by the `UNIQUE (feed_date, rank)` constraint).

8. **Usage tracking is per image per calendar month, capped at 3.** The brief's
   "one image can be used at most 3 times a month" is implemented with a rolling
   calendar-month window (`usage_month` = `YYYY-MM` in UTC) and a row lock so
   concurrent uses are counted correctly.

9. **"Moodboards" were left out of scope.** The brief mentions them only in a
   stretch bullet with no API or storage contract; we store nothing about
   moodboards. The feed API and usage tracking cover the required surface.

## Technical assumptions

10. **PGlite for the demo, real Postgres for production.** `DATABASE_URL` blank
    (or `pglite://`) uses the embedded WASM Postgres — zero install, matches the
    schema 1:1. A `postgres://` URL switches to the `pg` driver. This avoids
    requiring the reviewer to run a Postgres server.

11. **Mock providers are the default.** Pinterest (`mock`), vision (`mock`), Slack
    (`mock`), and scraping (`fixture`) need no credentials or network. Real
    providers are one env-flag away. Sample data (`sample-data/`) is committed so
    the demo is deterministic.

12. **Node 24 type-stripping.** We use `tsx`-free `node --test` and `tsc --noEmit`
    with `erasableSyntaxOnly`. Constructor parameter properties are therefore
    forbidden (written as explicit field declarations).

13. **UTC everywhere.** All timestamps are stored in UTC; `date`-typed columns use
    the server's date. The "daily" run boundaries (02:00 / 03:30 IST in n8n) are
    presentation-time only.

14. **Object storage is abstracted.** Local filesystem (default), MinIO
    (S3-compatible), or real AWS S3 behind one interface. `image_s3_url` is always
    `CDN_BASE_URL + key` so the API contract doesn't leak the storage backend.

15. **Images that cannot be downloaded are skipped, not failed.** A look with an
    unloadable image is recorded with a `skippedNoImage` count in the collection
    summary and the pipeline continues. Analysis likewise skips rows with no stored
    image instead of failing the batch.

16. **A collector failure does not abort the day's run.** Per the brief's
    Slack-alert requirement, a failing source is logged + alerted, and the remaining
    sources still run.

## Open questions for the product team

- Exact trend-score weights and the recency decay shape (currently linear, 7 days).
- What "save count" means for non-Pinterest sources (Instagram CSV, scrapers).
- Whether a "use" means a save, a purchase, or a click (affects how the 3/month cap
  is audited).
- Who curates manually and whether manual scores override or blend with the computed
  score.
- Moodboard API scope (out of scope here).