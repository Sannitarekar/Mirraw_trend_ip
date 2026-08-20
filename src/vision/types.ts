/**
 * Structured fashion attributes extracted by the Vision layer (spec section 7).
 * Each field's expected value domain is documented from the spec's table.
 */
export interface TrendAttributes {
  garment_type: string; // saree, lehenga, anarkali, kurta, sharara, coord set
  color_palette: string[]; // e.g. ['ivory', 'gold', 'mint green']
  pattern: string; // floral, geometric, abstract, solid, paisley, bandhani
  fabric_texture: string; // silk, chiffon, georgette, cotton, velvet, organza
  embellishment: string; // zari, sequins, mirror work, embroidery, none
  silhouette: string; // A-line, straight, flared, fitted
  occasion: string; // wedding, festive, casual, party, daily wear
  neckline: string; // round, V-neck, square, halter, boat
  sleeve_style: string; // sleeveless, 3/4, full, bell
  trend_season: string; // summer 2026, festive 2026, winter 2026
}

export const ATTRIBUTE_KEYS: (keyof TrendAttributes)[] = [
  "garment_type",
  "color_palette",
  "pattern",
  "fabric_texture",
  "embellishment",
  "silhouette",
  "occasion",
  "neckline",
  "sleeve_style",
  "trend_season",
];

/** Value used whenever the model has low confidence (spec 7.1). */
export const UNKNOWN = "unknown";

export interface VisionImageInput {
  id: string;
  bytes: Uint8Array;
  mimeType: string | null;
}

/** A Vision model — abstracted so Claude / GPT-4o / mock are swappable. */
export interface VisionProvider {
  readonly name: string;
  analyze(image: VisionImageInput): Promise<TrendAttributes>;
}

/** Thrown when the model returns invalid/non-JSON output. */
export class VisionMalformedResponseError extends Error {
  constructor(message: string) {
    super(`vision: malformed model response — ${message}`);
    this.name = "VisionMalformedResponseError";
  }
}