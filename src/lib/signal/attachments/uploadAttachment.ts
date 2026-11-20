import type { MessageInitShape } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { AttachmentPointerSchema } from '../proto/generated/SignalService_pb';

import { SIGNAL_CDN_HOSTS } from '../config';
import { bufferToBase64 } from '../../../util/encoding/buffer';
import { encodeUtf8 } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { encryptAttachment } from './attachmentCrypto';

export type AttachmentMetadata = Omit<
  MessageInitShape<typeof AttachmentPointerSchema>,
  'attachmentIdentifier' | 'cdnNumber' | 'key' | 'size' | 'digest' | 'uploadTimestamp' | '$typeName'
>;

type UploadAttachmentOptions = {
  signal?: AbortSignal;
  // Follows the encrypted bytes sent
  onProgress?: (sentLength: number, totalLength: number) => void;
};

type UploadForm = {
  cdn: number;
  key: string;
  headers: Record<string, string>;
  signedUploadLocation: string;
};

const TUS_CDN_NUMBER = 3;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_PAYLOAD_TOO_LARGE = 413;

/**
 * Encrypts an attachment, uploads it to CDN 3 with a TUS creation-with-upload request and returns its
 * pointer for a `DataMessage` (Signal Desktop `ts/util/uploadAttachment.preload.ts`)
 */
export async function uploadAttachment(
  connection: ChatConnection,
  data: Uint8Array,
  metadata: AttachmentMetadata,
  { signal, onProgress }: UploadAttachmentOptions = {},
) {
  const { encrypted, key, digest } = await encryptAttachment(data);

  const { status, json: form } = await connection.sendJsonRequest<UploadForm>(
    'GET', `/v4/attachments/form/upload?uploadLength=${encrypted.length}`,
  );
  if (status === HTTP_PAYLOAD_TOO_LARGE) throw new Error('Attachment is too large');
  if (status !== HTTP_OK || !form) throw new Error(`Upload form request failed with HTTP ${status}`);
  if (form.cdn !== TUS_CDN_NUMBER) throw new Error(`Uploads to CDN ${form.cdn} are not supported`);

  const location = new URL(form.signedUploadLocation);
  if (location.protocol !== 'https:' || location.hostname !== SIGNAL_CDN_HOSTS[TUS_CDN_NUMBER]) {
    throw new Error(`Unexpected upload location ${location.origin}`);
  }

  const response = await sendHttpRequest(location.hostname, {
    method: 'POST',
    path: `${location.pathname}${location.search}`,
    headers: {
      ...form.headers,
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(encrypted.length),
      'Upload-Metadata': `filename ${bufferToBase64(encodeUtf8(form.key))}`,
      'Content-Type': 'application/offset+octet-stream',
    },
    body: encrypted,
    signal,
    onSendProgress: onProgress,
  });
  if (response.status !== HTTP_CREATED && response.status !== HTTP_OK) {
    throw new Error(`Attachment upload failed with HTTP ${response.status}`);
  }

  return {
    ...metadata,
    attachmentIdentifier: { case: 'cdnKey' as const, value: form.key },
    cdnNumber: TUS_CDN_NUMBER,
    key,
    size: data.length,
    digest,
    uploadTimestamp: BigInt(Date.now()),
  } satisfies MessageInitShape<typeof AttachmentPointerSchema>;
}
