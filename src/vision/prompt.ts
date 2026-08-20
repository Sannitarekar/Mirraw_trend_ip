/**
 * The structured extraction prompt from spec section 7.1, verbatim.
 */
export const VISION_SYSTEM_PROMPT = "You are a fashion attribute extractor for Indian ethnic wear.";

export const VISION_USER_PROMPT =
  "Analyze this garment image and return ONLY a JSON object with keys: " +
  "garment_type, color_palette, pattern, fabric_texture, embellishment, silhouette, " +
  "occasion, neckline, sleeve_style, trend_season. " +
  "If confidence on any attribute is low, set value to 'unknown' rather than guessing.";