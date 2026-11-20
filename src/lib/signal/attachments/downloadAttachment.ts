import type { AttachmentPointer } from '../proto/generated/SignalService_pb';

import { SIGNAL_CDN_HOSTS } from '../config';
import { sendHttpRequest } from '../net/http';
import { decryptAttachment } from './attachmentCrypto';

const HTTP_OK = 200;

/** Downloads an attachment from the CDN in `cdnNumber` and returns its decrypted, unpadded bytes */
export async function downloadAttachment(pointer: AttachmentPointer) {
  const { cdnNumber, attachmentIdentifier } = pointer;
  const host = SIGNAL_CDN_HOSTS[cdnNumber];
  const id = attachmentIdentifier.case ? String(attachmentIdentifier.value) : undefined;
  if (!host || !id) throw new Error(`Attachment has no location on CDN ${cdnNumber}`);
  if (!pointer.key.length) throw new Error('Attachment has no key');

  const response = await sendHttpRequest(host, { method: 'GET', path: `/attachments/${encodeURIComponent(id)}` });
  if (response.status !== HTTP_OK) throw new Error(`Attachment download failed with HTTP ${response.status}`);

  return decryptAttachment(response.body, pointer.key, pointer.digest, pointer.size);
}
