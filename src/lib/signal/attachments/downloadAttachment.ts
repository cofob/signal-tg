import type { AttachmentPointer } from '../proto/generated/SignalService_pb';

import { SIGNAL_CDN_HOSTS } from '../config';
import { sendHttpRequest } from '../net/http';
import { decryptAttachment, getAttachmentCiphertextLength } from './attachmentCrypto';

type DownloadAttachmentOptions = {
  signal?: AbortSignal;
  onProgress?: (receivedLength: number, totalLength: number) => void;
};

const HTTP_OK = 200;
// Signal Desktop `ts/textsecure/downloadAttachment.preload.ts` (`checkSize`) allows 5% over the expected length
const MAX_LENGTH_FACTOR = 1.05;

/**
 * Downloads an attachment from the CDN in `cdnNumber` and returns its decrypted, unpadded bytes. A body much
 * longer than the pointer's size promises is refused before it downloads.
 */
export async function downloadAttachment(
  pointer: AttachmentPointer, { signal, onProgress }: DownloadAttachmentOptions = {},
) {
  const { cdnNumber, attachmentIdentifier } = pointer;
  const host = SIGNAL_CDN_HOSTS[cdnNumber];
  const id = attachmentIdentifier.case ? String(attachmentIdentifier.value) : undefined;
  if (!host || !id) throw new Error(`Attachment has no location on CDN ${cdnNumber}`);
  if (!pointer.key.length) throw new Error('Attachment has no key');

  const maxLength = Math.floor(getAttachmentCiphertextLength(pointer.size) * MAX_LENGTH_FACTOR);
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort(signal.reason));

  const response = await sendHttpRequest(host, {
    method: 'GET',
    path: `/attachments/${encodeURIComponent(id)}`,
    signal: controller.signal,
    onReceiveProgress: (receivedLength, totalLength) => {
      if (totalLength > maxLength) {
        controller.abort(new Error(`Attachment has ${totalLength} bytes, expected at most ${maxLength}`));
        return;
      }
      onProgress?.(receivedLength, totalLength);
    },
  });
  // Transit tier objects expire after some weeks; the CDN then answers 404 (CDN 0: 403)
  if (response.status !== HTTP_OK) throw new Error(`Attachment download failed with HTTP ${response.status}`);

  return decryptAttachment(response.body, pointer.key, pointer.digest, pointer.size);
}
