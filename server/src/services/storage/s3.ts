import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from './index.js';

/**
 * S3-compatible object storage (Cloudflare R2, Backblaze B2, AWS S3, MinIO).
 *
 * Audio written here survives redeploys, unlike the local provider which
 * writes to the container filesystem.
 *
 * Required env:
 *   S3_ENDPOINT          e.g. https://<account>.r2.cloudflarestorage.com
 *   S3_BUCKET
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 * Optional:
 *   S3_REGION            default "auto" (correct for R2)
 *   S3_PUBLIC_BASE_URL   public bucket / CDN origin. When set, getPublicUrl
 *                        returns a permanent URL; otherwise callers get a
 *                        presigned URL via getUrl().
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicBaseUrl?: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3 storage selected but not configured. Set S3_ENDPOINT, S3_BUCKET, ' +
          'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.'
      );
    }

    this.bucket = bucket;
    this.publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, '');
    this.client = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // R2 and MinIO need path-style addressing
      forcePathStyle: true,
    });
  }

  /** Strip the leading /audio/ the app sometimes prefixes onto keys. */
  private normalise(key: string): string {
    return key.replace(/^\/?audio\//, '').replace(/^\/+/, '');
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    const k = this.normalise(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: k,
        Body: data,
        ContentType: contentType,
      })
    );
    return key;
  }

  async getUrl(key: string, expiresIn = 3600): Promise<string> {
    const k = this.normalise(key);
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${k}`;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: k }),
      { expiresIn }
    );
  }

  getPublicUrl(key: string): string {
    const k = this.normalise(key);
    // Without a public base URL there is no permanent link; callers that need
    // one should await getUrl(). Returning the app path keeps the local route
    // working as a fallback rather than handing back something broken.
    return this.publicBaseUrl ? `${this.publicBaseUrl}/${k}` : `/audio/${k}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.normalise(key) })
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.normalise(key) })
      );
      return true;
    } catch {
      return false;
    }
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${this.normalise(sourceKey)}`,
        Key: this.normalise(destKey),
      })
    );
  }
}
