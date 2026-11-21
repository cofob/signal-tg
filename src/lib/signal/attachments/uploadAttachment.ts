import type { MessageInitShape } from '@bufbuild/protobuf';

import type ChatConnection from '../chat/ChatConnection';
import type { AttachmentPointerSchema } from '../proto/generated/SignalService_pb';

import { SIGNAL_CDN_HOSTS } from '../config';
import { bufferToBase64 } from '../../../util/encoding/buffer';
import { encodeUtf8 } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { SendHttpError } from '../sender/sendErrors';
import { encryptAttachment } from './attachmentCrypto';

import { Http2Error } from '../net/Http2Connection';
import NetworkError from '../net/NetworkError';

export type AttachmentMetadata = Omit<
  MessageInitShape<typeof AttachmentPointerSchema>,
  'attachmentIdentifier' | 'cdnNumber' | 'key' | 'size' | 'digest' | 'uploadTimestamp' | '$typeName'
>;

export type UploadAttachmentOptions = {
  signal?: AbortSignal;
  // Follows the encrypted bytes sent
  onProgress?: (sentLength: number, totalLength: number) => void;
};

export type UploadForm = {
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
 * pointer for a `DataMessage` (Signal Desktop `ts/util/uploadAttachment.preload.ts`). An upload that fails
 * because the connection did not hold, as one reused after the server closed it does, starts over once with a
 * new upload form: the failed request may have created its upload, so it is not repeated as it is.
 */
export async function uploadAttachment(
  connection: ChatConnection,
  data: Uint8Array,
  metadata: AttachmentMetadata,
  options: UploadAttachmentOptions = {},
) {
  const { encrypted, key, digest } = await encryptAttachment(data);

  let cdnKey: string;
  try {
    cdnKey = await putEncryptedAttachment(connection, encrypted, options);
  } catch (err) {
    if (!(err instanceof NetworkError || err instanceof Http2Error) || options.signal?.aborted) throw err;
    cdnKey = await putEncryptedAttachment(connection, encrypted, options);
  }

  return {
    ...metadata,
    attachmentIdentifier: { case: 'cdnKey' as const, value: cdnKey },
    cdnNumber: TUS_CDN_NUMBER,
    key,
    size: data.length,
    digest,
    uploadTimestamp: BigInt(Date.now()),
  } satisfies MessageInitShape<typeof AttachmentPointerSchema>;
}

/** Gets an upload form and sends the encrypted attachment with it; returns the CDN key */
async function putEncryptedAttachment(
  connection: ChatConnection, encrypted: Uint8Array, options: UploadAttachmentOptions,
) {
  const { status, json: form } = await connection.sendJsonRequest<UploadForm>(
    'GET', `/v4/attachments/form/upload?uploadLength=${encrypted.length}`,
  );
  if (status === HTTP_PAYLOAD_TOO_LARGE) throw new Error('Attachment is too large');
  if (status !== HTTP_OK || !form) throw new SendHttpError(status, `Upload form request failed with HTTP ${status}`);

  await putTusUpload(form, encrypted, options);
  return form.key;
}

/**
 * Sends `data` to the upload location of an upload form with a TUS creation-with-upload request; the CDN of the form
 * has to be CDN 3. The attachment forms and the forms of the backup service (`GET /v1/archives/upload/form`) take it.
 */
export async function putTusUpload(
  form: UploadForm, data: Uint8Array, { signal, onProgress }: UploadAttachmentOptions = {},
) {
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
      'Upload-Length': String(data.length),
      'Upload-Metadata': `filename ${bufferToBase64(encodeUtf8(form.key))}`,
      'Content-Type': 'application/offset+octet-stream',
    },
    body: data,
    signal,
    onSendProgress: onProgress,
  });
  if (response.status !== HTTP_CREATED && response.status !== HTTP_OK) {
    throw new SendHttpError(response.status, `Upload failed with HTTP ${response.status}`);
  }
}
