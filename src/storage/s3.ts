import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getConfig } from "../shared/config.ts";
import type { ObjectStorage, StoredObject } from "./types.ts";

/**
 * S3-compatible object storage driver.
 *
 * Works against real AWS S3 and MinIO (S3-compatible API). Which one is
 * determined by config: an S3_ENDPOINT plus FORCE_PATH_STYLE=true means
 * MinIO; otherwise it's AWS. Credentials come from environment variables.
 *
 * This driver is included for production parity; the demo defaults to the
 * LocalDiskStorage mock so no cloud credentials are required.
 */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cdnBaseUrl: string;

  constructor() {
    const cfg = getConfig();
    this.bucket = cfg.S3_BUCKET;
    this.cdnBaseUrl = cfg.CDN_BASE_URL.replace(/\/+$/, "");
    const clientConfig: S3ClientConfig = {
      region: cfg.S3_REGION,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    };
    if (cfg.S3_ENDPOINT) {
      clientConfig.endpoint = cfg.S3_ENDPOINT;
    }
    if (cfg.S3_ACCESS_KEY && cfg.S3_SECRET_KEY) {
      clientConfig.credentials = {
        accessKeyId: cfg.S3_ACCESS_KEY,
        secretAccessKey: cfg.S3_SECRET_KEY,
      };
    }
    this.client = new S3Client(clientConfig);
  }

  async put(key: string, data: Uint8Array, contentType?: string): Promise<StoredObject> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType ?? "application/octet-stream",
    });
    await this.client.send(command);
    return { key, size: data.byteLength, contentType: contentType ?? null };
  }

  async get(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    if (!response.Body) throw new Error(`S3 object is empty: ${key}`);
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
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
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}