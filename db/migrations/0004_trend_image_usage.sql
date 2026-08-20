-- 0004_trend_image_usage.sql
-- Spec section 10: POST /api/v1/trends/{id}/used records usage and enforces a
-- maximum of 3 uses per image per calendar month. The PDF does not define this
-- table (ASSUMPTIONS.md #2). usage_month is a 'YYYY-MM' text key (UTC month).
--
-- Concurrency: the API handler locks the parent raw_trend_images row
-- (SELECT ... FOR UPDATE) inside a transaction before counting, which
-- serializes concurrent /used calls for the same image.

CREATE TABLE IF NOT EXISTS trend_image_usage (
  id           uuid PRIMARY KEY,
  raw_image_id uuid NOT NULL REFERENCES raw_trend_images(id) ON DELETE CASCADE,
  used_at      timestamptz NOT NULL DEFAULT now(),
  usage_month  char(7)     NOT NULL        -- e.g. '2026-08'
);

-- Fast "count usages for image X in month M".
CREATE INDEX IF NOT EXISTS idx_usage_image_month
  ON trend_image_usage (raw_image_id, usage_month);