-- 0003_trend_feed.sql
-- Spec sections 8 and 11: the "TREND_FEED" table. The PDF names it but does
-- not define its schema (ASSUMPTIONS.md #1). Top 200 scored images per day
-- are promoted here; the API reads exclusively from this table.

CREATE TABLE IF NOT EXISTS trend_feed (
  id          uuid PRIMARY KEY,
  raw_image_id uuid NOT NULL UNIQUE REFERENCES raw_trend_images(id) ON DELETE CASCADE,
  trend_score float NOT NULL,
  feed_date   date  NOT NULL,           -- the day the image was promoted (per-day top 200)
  rank        int   NOT NULL,           -- rank within that day's feed (1..200)
  promoted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_trend_feed_date_image UNIQUE (feed_date, raw_image_id)
);

-- Primary feed query: a date range ordered by trend_score.
CREATE INDEX IF NOT EXISTS idx_trend_feed_date_score
  ON trend_feed (feed_date, trend_score DESC);