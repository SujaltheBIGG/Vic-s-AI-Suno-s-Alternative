import type { StorageProvider } from './index.js';
import { LocalStorageProvider } from './local.js';
import { S3StorageProvider } from './s3.js';

let storageInstance: StorageProvider | null = null;

/**
 * Picks the storage backend.
 *
 * STORAGE_PROVIDER=s3  (or simply setting S3_BUCKET) uses S3-compatible object
 * storage, which survives redeploys. Anything else falls back to the local
 * filesystem, which is correct for development but loses data on any host with
 * an ephemeral filesystem.
 */
export function getStorageProvider(): StorageProvider {
  if (storageInstance) {
    return storageInstance;
  }

  const wantsS3 =
    process.env.STORAGE_PROVIDER === 's3' || Boolean(process.env.S3_BUCKET);

  if (wantsS3) {
    try {
      storageInstance = new S3StorageProvider();
      console.log(
        `Initializing S3 storage provider (bucket: ${process.env.S3_BUCKET})`
      );
      return storageInstance;
    } catch (err) {
      // Never take the app down over storage config — fall back and be loud.
      console.error(
        '[storage] S3 provider failed to initialise, falling back to local:',
        (err as Error).message
      );
    }
  }

  console.log('Initializing local storage provider');
  storageInstance = new LocalStorageProvider();
  return storageInstance;
}

export function resetStorageProvider(): void {
  storageInstance = null;
}
