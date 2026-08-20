/**
 * Object storage interface.
 *
 * Every driver (local disk mock, S3-compatible MinIO, real AWS S3) implements
 * this same interface, so the collectors, vision pipeline, and API never care
 * which backend is configured. The API builds image URLs from keys via
 * publicUrl() (CDN_BASE_URL in production, the API's /files route locally).
 */
export interface StoredObject {
  key: string;
  size: number;
  contentType: string | null;
}

export interface ObjectStorage {
  /** Persist bytes under `key`; returns storage metadata. */
  put(key: string, data: Uint8Array, contentType?: string): Promise<StoredObject>;
  /** Read the full object back. */
  get(key: string): Promise<Buffer>;
  /** True when the object exists. */
  exists(key: string): Promise<boolean>;
  /** Build the externally-addressable URL for a key. */
  publicUrl(key: string): string;
  /** Remove the object (used by cleanup). */
  delete(key: string): Promise<void>;
}