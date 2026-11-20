import { fromBinary } from '@bufbuild/protobuf';

import type { AttachmentPointer } from '../../../lib/signal/proto/generated/SignalService_pb';
import type { ApiOnProgress } from '../../types';

import { downloadAttachment } from '../../../lib/signal/attachments/downloadAttachment';
import { DataMessageSchema } from '../../../lib/signal/proto/generated/SignalService_pb';
import * as cacheApi from '../../../util/cacheApi';
import { bufferToHex } from '../../../util/encoding/buffer';
import { getSafeMimeType } from '../../../util/media/safeMimeType';
import { parseAttachmentMediaId, STICKER_SLOT } from '../builders/media';
import { db } from '../engine';

type AttachmentLocation = Pick<AttachmentPointer, 'attachmentIdentifier' | 'cdnNumber' | 'digest'>;

type DownloadState = {
  controller: AbortController;
  callbacks: Set<ApiOnProgress>;
  // A request without a progress callback cannot cancel, so the download continues for it
  hasUncancelableRequest?: boolean;
  reportedProgress: number;
};

type Download = DownloadState & {
  promise: Promise<Blob>;
};

// Decrypted attachments stay until logout, outside the app's expiring media caches: the CDN deletes them
// after some weeks, while Signal Desktop keeps them on disk
const ATTACHMENT_CACHE_NAME = 'ts-signal-attachments';
const PROGRESS_STEP = 0.01;

const downloads = new Map<string, Download>();
// Serves the parts of a streamed file while it is being saved, or when the cache is unavailable
let lastDownloaded: { key: string; blob: Blob } | undefined;

/** The attachment pointer that a media id from `buildMessageMedia` refers to */
export async function getAttachmentPointer(mediaId: string) {
  const parsed = parseAttachmentMediaId(mediaId);
  if (!parsed) return undefined;
  const message = await db.getMessage(parsed.messageId);
  if (!message?.dataMessage) return undefined;

  const { attachments, sticker } = fromBinary(DataMessageSchema, message.dataMessage);
  return parsed.slot === STICKER_SLOT ? sticker?.data : attachments[parsed.slot];
}

/**
 * The decrypted attachment, from the cache or the CDN. Requests for the same attachment share one download,
 * which stops once every request with a progress callback is canceled.
 */
export async function fetchAttachmentBlob(pointer: AttachmentPointer, onProgress?: ApiOnProgress) {
  const key = getCacheKey(pointer);
  if (lastDownloaded?.key === key) return lastDownloaded.blob;

  const cached: Blob | undefined = await cacheApi.fetch(ATTACHMENT_CACHE_NAME, key, cacheApi.Type.Blob);
  if (cached) return cached;

  const download = downloads.get(key) ?? startDownload(key, pointer);
  if (onProgress) {
    download.callbacks.add(onProgress);
  } else {
    download.hasUncancelableRequest = true;
  }
  return download.promise;
}

/** Keeps a sent attachment, so it shows without a download */
export async function saveAttachmentBlob(pointer: AttachmentLocation, blob: Blob) {
  await cacheApi.save(ATTACHMENT_CACHE_NAME, getCacheKey(pointer), blob);
}

export async function clearAttachmentCache() {
  lastDownloaded = undefined;
  await cacheApi.clear(ATTACHMENT_CACHE_NAME);
}

function startDownload(key: string, pointer: AttachmentPointer) {
  const state: DownloadState = { controller: new AbortController(), callbacks: new Set(), reportedProgress: 0 };
  const download: Download = Object.assign(state, {
    promise: downloadToCache(key, pointer, state).finally(() => downloads.delete(key)),
  });
  downloads.set(key, download);
  return download;
}

async function downloadToCache(key: string, pointer: AttachmentPointer, state: DownloadState) {
  const data = await downloadAttachment(pointer, {
    signal: state.controller.signal,
    onProgress: (receivedLength, totalLength) => {
      if (totalLength) reportProgress(state, receivedLength / totalLength);
    },
  });
  const blob = new Blob([data], { type: getSafeMimeType(pointer.contentType) });
  lastDownloaded = { key, blob };
  await cacheApi.save(ATTACHMENT_CACHE_NAME, key, blob);
  return blob;
}

function reportProgress(state: DownloadState, progress: number) {
  const activeCallbacks = [...state.callbacks].filter((callback) => !callback.isCanceled);
  if (state.callbacks.size && !activeCallbacks.length && !state.hasUncancelableRequest) {
    state.controller.abort(new Error('Attachment download is canceled'));
    return;
  }

  if (progress < 1 && progress - state.reportedProgress < PROGRESS_STEP) return;
  state.reportedProgress = progress;
  activeCallbacks.forEach((callback) => callback(progress));
}

/** Attachments are cached by their digest, which changes with every upload, or by their CDN location */
function getCacheKey({ attachmentIdentifier, cdnNumber, digest }: AttachmentLocation) {
  return digest.length
    ? `attachment/${bufferToHex(digest)}`
    : `attachment/${cdnNumber}/${encodeURIComponent(String(attachmentIdentifier.value))}`;
}
