import { compareBuffersConstantTime } from '../../util/encoding/buffer';
import { wasm } from './wasm';

const PADDING_BLOCK = 80;
const PADDING_TERMINATOR = 0x80;
const MAX_REGISTRATION_ID = 0x3fff;
const AES_GCM_NONCE_LENGTH = 12;

const textEncoder = new TextEncoder();

export function getRandomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Registration ids are 14-bit and nonzero */
export function generateRegistrationId() {
  const [value] = crypto.getRandomValues(new Uint16Array(1));
  return (value & MAX_REGISTRATION_ID) || 1;
}

export function encodeUtf8(text: string) {
  return textEncoder.encode(text);
}

export async function hmacSha256(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
}

export async function verifyHmacSha256(
  data: Uint8Array<ArrayBuffer>, key: Uint8Array<ArrayBuffer>, mac: Uint8Array, length: number,
) {
  const expected = (await hmacSha256(key, data)).subarray(0, length);
  if (mac.length !== length || !compareBuffersConstantTime(expected, mac)) {
    throw new Error('Bad MAC');
  }
}

/** AES-256-CBC with PKCS#7 padding */
export async function decryptAesCbc(
  key: Uint8Array<ArrayBuffer>, ciphertext: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>,
) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, ciphertext));
}

export async function encryptAesCtr(
  key: Uint8Array<ArrayBuffer>, plaintext: Uint8Array<ArrayBuffer>, counter: Uint8Array<ArrayBuffer>,
) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-CTR', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-CTR', counter, length: 128 }, cryptoKey, plaintext);
  return new Uint8Array(ciphertext);
}

/** AES-256-GCM with the 12-byte nonce prepended to the ciphertext, as storage service records use */
export async function decryptAesGcmWithNonce(key: Uint8Array<ArrayBuffer>, data: Uint8Array) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const iv = data.slice(0, AES_GCM_NONCE_LENGTH);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data.slice(AES_GCM_NONCE_LENGTH));
  return new Uint8Array(plaintext);
}

/** HKDF-SHA256 */
export function deriveSecrets(length: number, inputKey: Uint8Array, info: Uint8Array, salt?: Uint8Array) {
  return wasm.HKDF_DeriveSecrets(length, inputKey, info, salt) as Uint8Array<ArrayBuffer>;
}

/** Pads `Content` plaintext before encryption: a 0x80 terminator, then zeros up to the next 80-byte block */
export function padMessage(message: Uint8Array) {
  const lengthWithTerminator = message.length + 1;
  const paddedLength = Math.ceil((lengthWithTerminator + 1) / PADDING_BLOCK) * PADDING_BLOCK - 1;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = PADDING_TERMINATOR;
  return padded;
}

export function unpadMessage(padded: Uint8Array) {
  for (let i = padded.length - 1; i >= 0; i--) {
    if (padded[i] === PADDING_TERMINATOR) return padded.subarray(0, i);
    if (padded[i] !== 0) throw new Error('Invalid message padding');
  }
  return padded;
}
