import type { AttachmentPointer } from '../proto/generated/SignalService_pb';

import * as cacheApi from '../../../util/cacheApi';
import { bufferToHex } from '../../../util/encoding/buffer';
import { getSafeMimeType } from '../../../util/media/safeMimeType';
import { hasAtRestKey, isEncryptingWrites, StorageLockedError } from '../store/atRest';
import { decryptBlob, encryptBlob, isEncryptedBlob } from './blobEncryption';

type AttachmentLocation = Pick<AttachmentPointer, 'attachmentIdentifier' | 'cdnNumber' | 'digest'>;

// Decrypted attachments stay until logout, outside the app's expiring media caches: the CDN deletes them
// after some weeks, while Signal Desktop keeps them on disk
export const ATTACHMENT_CACHE_NAME = 'ts-signal-attachments';

/**
 * Keeps a decrypted attachment, so it shows without a download. While the engine encrypts its stores, the file is
 * encrypted too (`blobEncryption.ts`).
 */
export async function saveAttachmentBlob(pointer: AttachmentLocation, blob: Blob) {
  await saveCachedBlob(getAttachmentCacheKey(pointer), blob);
}

export async function saveCachedBlob(key: string, blob: Blob) {
  try {
    const data = isEncryptingWrites() ? await encryptBlob(blob, cacheApi.getCacheKeyPath(key)) : blob;
    await cacheApi.save(ATTACHMENT_CACHE_NAME, key, data);
  } catch (err) {
    // Without the key the file is not cached, rather than cached in the clear
    if (!(err instanceof StorageLockedError)) throw err;
  }
}

/** The cached file, decrypted when it is stored encrypted; a file that cannot be decrypted counts as absent */
export async function fetchCachedBlob(key: string): Promise<Blob | undefined> {
  const cached: Blob | undefined = await cacheApi.fetch(ATTACHMENT_CACHE_NAME, key, cacheApi.Type.Blob);
  const keyPath = cacheApi.getCacheKeyPath(key);
  if (!cached || !await isEncryptedBlob(cached, keyPath, hasAtRestKey())) return cached;
  if (!hasAtRestKey()) return undefined;

  try {
    return await decryptBlob(cached, keyPath, getSafeMimeType);
  } catch (err) {
    // A damaged file is downloaded again
    return undefined;
  }
}

/**
 * Rewrites the cached files of every account slot encrypted or decrypted, as the stores are converted. A file that
 * cannot be decrypted is only a cache entry and is deleted, so it never blocks decrypting everything else.
 */
export async function convertCachedBlobs(direction: 'encrypt' | 'decrypt') {
  await cacheApi.rewriteBlobs(ATTACHMENT_CACHE_NAME, async (blob, keyPath) => {
    const isEncrypted = await isEncryptedBlob(blob, keyPath);
    if (direction === 'encrypt') return isEncrypted ? undefined : encryptBlob(blob, keyPath);
    if (!isEncrypted) return undefined;

    try {
      return await decryptBlob(blob, keyPath, getSafeMimeType);
    } catch (err) {
      // Without the key the file may still be readable later, so it stays
      if (err instanceof StorageLockedError) throw err;
      return false;
    }
  }, true);
}

/** How many cached files of every account slot are encrypted and how many are not */
export async function countCachedBlobs() {
  const counts = { encrypted: 0, plain: 0 };
  await cacheApi.rewriteBlobs(ATTACHMENT_CACHE_NAME, async (blob, keyPath) => {
    counts[await isEncryptedBlob(blob, keyPath, hasAtRestKey()) ? 'encrypted' : 'plain']++;
    return undefined;
  }, true);
  return counts;
}

/** Whether the decrypted attachment is cached */
export async function getIsAttachmentCached(pointer: AttachmentLocation) {
  const cached = await cacheApi.fetch(ATTACHMENT_CACHE_NAME, getAttachmentCacheKey(pointer), cacheApi.Type.Blob);
  return Boolean(cached);
}

/** Drops a cached attachment, such as the media of an expired story */
export async function removeAttachmentBlob(pointer: AttachmentLocation) {
  await cacheApi.remove(ATTACHMENT_CACHE_NAME, getAttachmentCacheKey(pointer));
}

/** Attachments are cached by their digest, which changes with every upload, or by their CDN location */
export function getAttachmentCacheKey({ attachmentIdentifier, cdnNumber, digest }: AttachmentLocation) {
  return digest.length
    ? `attachment/${bufferToHex(digest)}`
    : `attachment/${cdnNumber}/${encodeURIComponent(String(attachmentIdentifier.value))}`;
}
