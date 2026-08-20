import type { AppConfig } from "../shared/config.ts";
import { getConfig } from "../shared/config.ts";

/**
 * Editorial fashion publications are treated as the most authoritative trend
 * signal, curated social platforms next, and generic web scrapes last
 * (spec section 9.3, "authority" weighting).
 *
 * NOTE: "fdci-lakme" is the FDCI x Lakmé Fashion Week site scraped by the
 * scraper; it is part of the FDCI editorial family so it gets the editorial
 * authority. Assumption recorded in ASSUMPTIONS.md.
 */
const EDITORIAL_SOURCES = new Set(["vogue", "filmfare", "fdci-lakme"]);
const SOCIAL_SOURCES = new Set(["pinterest", "instagram"]);

/** Authority coefficient (0..1) for a collection source. */
export function sourceAuthority(source: string, config: AppConfig = getConfig()): number {
  if (EDITORIAL_SOURCES.has(source)) return config.SOURCE_AUTHORITY_VOGUE_FDCI;
  if (SOCIAL_SOURCES.has(source)) return config.SOURCE_AUTHORITY_PINTEREST;
  return config.SOURCE_AUTHORITY_SCRAPER;
}