import { compareBuffersConstantTime, concat } from '../../../util/encoding/buffer';
import {
  decryptAesCbc, encryptAesCbc, getRandomBytes, hmacSha256, verifyHmacSha256,
} from '../crypto';

const AES_KEY_LENGTH = 32;
const ATTACHMENT_KEY_LENGTH = 64;
const IV_LENGTH = 16;
const MAC_LENGTH = 32;
const MIN_PADDED_SIZE = 541;
const PADDING_GROWTH = 1.05;

/**
 * Encrypts an attachment as `IV || AES-256-CBC(PKCS#7) || HMAC-SHA256(IV || ciphertext)` with a new 64-byte key:
 * the AES key, then the MAC key. The plaintext is zero-padded first so the size reveals little
 * (Signal Desktop `ts/AttachmentCrypto.node.ts`). `digest` is the SHA-256 of the encrypted blob.
 */
export async function encryptAttachment(plaintext: Uint8Array) {
  const key = getRandomBytes(ATTACHMENT_KEY_LENGTH);
  const iv = getRandomBytes(IV_LENGTH);
  const padded = new Uint8Array(getPaddedSize(plaintext.length));
  padded.set(plaintext);

  const ciphertext = await encryptAesCbc(key.slice(0, AES_KEY_LENGTH), padded, iv);
  const ivAndCiphertext = concat(iv, ciphertext);
  const mac = await hmacSha256(key.slice(AES_KEY_LENGTH), ivAndCiphertext);
  const encrypted = concat(ivAndCiphertext, mac);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encrypted));
  return { encrypted, key, digest };
}

/**
 * Decrypts what `encryptAttachment` produced, checking the digest when given. A nonzero `size` cuts the padding.
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

/** Rounds sizes up to powers of 1.05 (Signal Desktop `ts/util/logPadSize.std.ts`) */
function getPaddedSize(size: number) {
  return Math.max(MIN_PADDED_SIZE, Math.floor(PADDING_GROWTH ** Math.ceil(Math.log(size) / Math.log(PADDING_GROWTH))));
}
