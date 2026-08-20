/**
 * Shapes of Pinterest API v5 responses we consume.
 * Only the fields the pipeline needs are typed; the full payload is preserved
 * verbatim in raw_metadata for audit.
 */
export interface PinterestPin {
  id: string;
  link?: string;
  title?: string;
  description?: string;
  board_owner?: { username?: string };
  board?: { id?: string; name?: string };
  media?: { images?: Record<string, { url?: string }>; image_type?: string };
  /** Present on some endpoints as engagement signal (v5: pin_metrics). */
  pin_metrics?: { save_count?: number };
  created_at?: string;
}

export interface PinterestBoard {
  id: string;
  name?: string;
  description?: string;
  owner?: { username?: string };
}

export interface PinsPage {
  items: PinterestPin[];
  /** Opaque cursor returned by v5 for the next page; empty when exhausted. */
  bookmark: string;
}

export interface PinsFetchOptions {
  boardId?: string;
  pageSize?: number;
  bookmark?: string;
}

export const DEFAULT_BOARD_KEYWORDS = [
  "ethnic wear",
  "sarees",
  "lehengas",
  "salwar suits",
  "kurtas",
  "fusion wear",
];