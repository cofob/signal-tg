import type { AttachmentPointer } from '../proto/generated/SignalService_pb';

import * as cacheApi from '../../../util/cacheApi';
import { bufferToHex } from '../../../util/encoding/buffer';

type AttachmentLocation = Pick<AttachmentPointer, 'attachmentIdentifier' | 'cdnNumber' | 'digest'>;

// Decrypted attachments stay until logout, outside the app's expiring media caches: the CDN deletes them
// after some weeks, while Signal Desktop keeps them on disk
export const ATTACHMENT_CACHE_NAME = 'ts-signal-attachments';

/** Keeps a decrypted attachment, so it shows without a download */
export async function saveAttachmentBlob(pointer: AttachmentLocation, blob: Blob) {
  await cacheApi.save(ATTACHMENT_CACHE_NAME, getAttachmentCacheKey(pointer), blob);
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
