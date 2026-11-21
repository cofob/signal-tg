import type { AttachmentPointer } from '../proto/generated/SignalService_pb';

import * as cacheApi from '../../../util/cacheApi';
import { bufferToHex } from '../../../util/encoding/buffer';
import { getSafeMimeType } from '../../../util/media/safeMimeType';
import { hasAtRestKey, isEncryptingWrites } from '../store/atRest';
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
  await cacheApi.save(ATTACHMENT_CACHE_NAME, key, isEncryptingWrites() ? await encryptBlob(blob) : blob);
}

/** The cached file, decrypted when it is stored encrypted; a file that cannot be decrypted counts as absent */
export async function fetchCachedBlob(key: string): Promise<Blob | undefined> {
  const cached: Blob | undefined = await cacheApi.fetch(ATTACHMENT_CACHE_NAME, key, cacheApi.Type.Blob);
  if (!cached || !await isEncryptedBlob(cached)) return cached;
  if (!hasAtRestKey()) return undefined;

  try {
    return await decryptBlob(cached, getSafeMimeType);
  } catch (err) {
    // A file that merely starts like an encrypted one, or a damaged one, is downloaded again
    return undefined;
  }
}

/** Rewrites the cached files encrypted or decrypted, as the stores are converted */
export async function convertCachedBlobs(direction: 'encrypt' | 'decrypt') {
  await cacheApi.rewriteBlobs(ATTACHMENT_CACHE_NAME, async (blob) => {
    const isEncrypted = await isEncryptedBlob(blob);
    if (direction === 'encrypt') return isEncrypted ? undefined : encryptBlob(blob);
    return isEncrypted ? decryptBlob(blob, getSafeMimeType) : undefined;
  });
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
