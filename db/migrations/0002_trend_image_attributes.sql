-- 0002_trend_image_attributes.sql
-- Spec section 9.2. Structured attributes produced by the Vision layer.
--
-- The spec's table (page 4) omits neckline / sleeve_style / trend_season even
-- though the extraction prompt (page 3) requires them. We add those three
-- columns so all ten extracted attributes are storable and API-returnable.
-- See ASSUMPTIONS.md.

CREATE TABLE IF NOT EXISTS trend_image_attributes (
  id             uuid PRIMARY KEY,
  raw_image_id   uuid NOT NULL UNIQUE REFERENCES raw_trend_images(id) ON DELETE CASCADE,
  garment_type   varchar(50) NOT NULL DEFAULT 'unknown',
  color_palette  text[]      NOT NULL DEFAULT '{}',
  pattern        varchar(50) NOT NULL DEFAULT 'unknown',
  fabric_texture varchar(50) NOT NULL DEFAULT 'unknown',
  embellishment  varchar(50) NOT NULL DEFAULT 'unknown',
  silhouette     varchar(50) NOT NULL DEFAULT 'unknown',
  occasion       varchar(50) NOT NULL DEFAULT 'unknown',
  neckline       varchar(50) NOT NULL DEFAULT 'unknown',
  sleeve_style   varchar(50) NOT NULL DEFAULT 'unknown',
  trend_season   varchar(50) NOT NULL DEFAULT 'unknown',
  trend_score    float       NOT NULL DEFAULT 0,      -- 0..100 composite score
  phash          varchar(64),                         -- perceptual hash for dedup
  analyzed_at    timestamptz  NOT NULL DEFAULT now()
);

-- FK is already indexed by the UNIQUE constraint on raw_image_id.

-- Feed filters on garment_type / occasion.
CREATE INDEX IF NOT EXISTS idx_attrs_garment_type ON trend_image_attributes (garment_type);
CREATE INDEX IF NOT EXISTS idx_attrs_occasion      ON trend_image_attributes (occasion);
-- Deduplication groups by phash.
CREATE INDEX IF NOT EXISTS idx_attrs_phash         ON trend_image_attributes (phash);