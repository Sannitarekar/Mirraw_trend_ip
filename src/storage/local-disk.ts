import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../shared/config.ts";
import type { ObjectStorage, StoredObject } from "./types.ts";

/**
 * Local filesystem mock of object storage.
 *
 * Used for the zero-setup demo. Keys map to files under LOCAL_STORAGE_DIR and
 * publicUrl() points at the API's /files route (CDN_BASE_URL). The interface
 * is identical to the S3 drivers, so switching to MinIO/AWS is config-only.
 */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;
  private readonly cdnBaseUrl: string;

  constructor(root?: string, cdnBaseUrl?: string) {
    const cfg = getConfig();
    this.root = path.resolve(root ?? cfg.LOCAL_STORAGE_DIR);
    this.cdnBaseUrl = (cdnBaseUrl ?? cfg.CDN_BASE_URL).replace(/\/+$/, "");
  }

  private resolve(key: string): string {
    // Normalize and prevent path traversal outside the root.
    const safe = path.normalize(key).replace(/^([.][.][/\\])+/, "");
    return path.join(this.root, safe);
  }

  async put(key: string, data: Uint8Array, contentType?: string): Promise<StoredObject> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    return { key, size: data.byteLength, contentType: contentType ?? null };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(key: string): string {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return `${this.cdnBaseUrl}/${encoded}`;
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}