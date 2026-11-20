import { compareBuffersConstantTime } from '../../util/encoding/buffer';
import { wasm } from './wasm';

const PADDING_BLOCK = 80;
const PADDING_TERMINATOR = 0x80;
const MAX_REGISTRATION_ID = 0x3fff;
const AES_GCM_NONCE_LENGTH = 12;
const MAX_RANDOM_PADDING_LENGTH = 512;

// SHA-256 round constants and initial hash values (FIPS 180-4)
const SHA256_K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const SHA256_INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_BLOCK_BYTES = 64;
const SHA256_LENGTH_BYTES = 8;
const BITS_PER_BYTE = 8;

const textEncoder = new TextEncoder();

export function getRandomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Sync and null messages carry random padding so their size does not reveal their kind */
export function getRandomPadding() {
  const [length] = crypto.getRandomValues(new Uint16Array(1));
  return getRandomBytes((length % MAX_RANDOM_PADDING_LENGTH) + 1);
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

/** AES-256-CBC with PKCS#7 padding */
export async function encryptAesCbc(
  key: Uint8Array<ArrayBuffer>, plaintext: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>,
) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, plaintext));
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

/**
 * SHA-256 for code that cannot wait for `crypto.subtle.digest`, such as building avatar colors.
 * Inputs are short, so the message length fits in 32 bits.
 */
export function sha256Sync(data: Uint8Array) {
  const blockCount = Math.ceil((data.length + 1 + SHA256_LENGTH_BYTES) / SHA256_BLOCK_BYTES);
  const padded = new Uint8Array(blockCount * SHA256_BLOCK_BYTES);
  padded.set(data);
  padded[data.length] = PADDING_TERMINATOR;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, data.length * BITS_PER_BYTE);

  const hash = Uint32Array.from(SHA256_INITIAL_HASH);
  const w = new Uint32Array(SHA256_K.length);
  for (let offset = 0; offset < padded.length; offset += SHA256_BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < w.length; i++) {
      const s0 = rotateRight(w[i - 15], 7) ^ rotateRight(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotateRight(w[i - 2], 17) ^ rotateRight(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < w.length; i++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const t1 = (h + sum1 + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const t2 = (sum0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((value, i) => {
      hash[i] += value;
    });
  }

  const digest = new Uint8Array(hash.length * 4);
  const digestView = new DataView(digest.buffer);
  hash.forEach((value, i) => digestView.setUint32(i * 4, value));
  return digest;
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

function rotateRight(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}
