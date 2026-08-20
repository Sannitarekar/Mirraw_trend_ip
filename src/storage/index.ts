import { getConfig } from "../shared/config.ts";
import { LocalDiskStorage } from "./local-disk.ts";
import { S3Storage } from "./s3.ts";
import type { ObjectStorage } from "./types.ts";

/**
 * Object storage factory.
 *
 * - local -> LocalDiskStorage (default demo, zero credentials)
 * - minio -> S3Storage pointed at a MinIO endpoint
 * - s3    -> S3Storage pointed at real AWS S3
 */
export function createStorage(driver?: string): ObjectStorage {
  const cfg = getConfig();
  const selected = driver ?? cfg.STORAGE_DRIVER;
  switch (selected) {
    case "minio":
    case "s3":
      return new S3Storage();
    case "local":
    default:
      return new LocalDiskStorage();
  }
}

export type { ObjectStorage, StoredObject } from "./types.ts";