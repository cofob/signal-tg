import type { AttachmentPointer } from '../proto/generated/SignalService_pb';

import { SIGNAL_CDN_HOSTS } from '../config';
import { compareBuffersConstantTime } from '../../../util/encoding/buffer';
import { decryptAesCbc, verifyHmacSha256 } from '../crypto';
import { sendHttpRequest } from '../net/http';

const AES_KEY_LENGTH = 32;
const ATTACHMENT_KEY_LENGTH = 64;
const IV_LENGTH = 16;
const MAC_LENGTH = 32;
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

/**
 * Attachments are `IV || AES-256-CBC(PKCS#7) || HMAC-SHA256(IV || ciphertext)` with a 64-byte key: the AES key,
 * then the MAC key. `digest` is the SHA-256 of the whole encrypted blob; plaintext is zero-padded to hide
 * its size, so a nonzero `size` truncates it.
 */
export async function decryptAttachment(
  encrypted: Uint8Array, key: Uint8Array, digest?: Uint8Array, size?: number,
) {
  if (key.length !== ATTACHMENT_KEY_LENGTH) throw new Error('Invalid attachment key');
  if (encrypted.length < IV_LENGTH + MAC_LENGTH) throw new Error('Attachment is too short');

  const blob = encrypted.slice();
  if (digest?.length) {
    const actualDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', blob));
    if (!compareBuffersConstantTime(actualDigest, digest)) throw new Error('Attachment digest mismatch');
  }

  const ivAndCiphertext = blob.slice(0, blob.length - MAC_LENGTH);
  const mac = blob.subarray(blob.length - MAC_LENGTH);
  await verifyHmacSha256(ivAndCiphertext, key.slice(AES_KEY_LENGTH), mac, MAC_LENGTH);

  const plaintext = await decryptAesCbc(
    key.slice(0, AES_KEY_LENGTH), blob.slice(IV_LENGTH, blob.length - MAC_LENGTH), blob.slice(0, IV_LENGTH),
  );
  return size && size < plaintext.length ? plaintext.subarray(0, size) : plaintext;
}
