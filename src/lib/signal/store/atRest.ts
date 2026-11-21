/**
 * Encryption at rest of the engine's stores (`docs/signal/PLAN.md`, "Шифрование хранилища движка код-паролем").
 * While a passcode exists, the page gives the engine a random key (`getEngineKey` in `src/util/passcode`), and records
 * are written as AES-GCM envelopes; records without an envelope are read as they are, which keeps an interrupted
 * migration readable.
 */

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const FORMAT_VERSION = 1;
const AAD_PREFIX = 'ts1|';
const HEADER_LENGTH_BYTES = 4;

const TAG_KEY = '$t';
const TAG_BYTES = 'b';
const TAG_BIGINT = 'i';
const TAG_MAP = 'm';
const TAG_SET = 's';
const TAG_DATE = 'd';
const TAG_NUMBER = 'n';
const TAG_UNDEFINED = 'u';

export type EncryptedValue = {
  $enc: typeof FORMAT_VERSION;
  iv: Uint8Array<ArrayBuffer>;
  data: Uint8Array<ArrayBuffer>;
};

/** The stores hold encrypted records and the key is not available */
export class StorageLockedError extends Error {
  constructor() {
    super('Local data is encrypted and the key is not available');
    this.name = 'StorageLockedError';
  }
}

let cryptoKey: CryptoKey | undefined;
// Whether new records are encrypted; it is off while the stores are decrypted again, when the key is still needed
let isWriting = false;

/**
 * Sets the key for reading, and with `shouldEncryptWrites` for writing. Without a key, encrypted records cannot be
 * read.
 */
export async function setAtRestKey(rawKey: ArrayBuffer | undefined, shouldEncryptWrites = true) {
  if (!rawKey) {
    cryptoKey = undefined;
    isWriting = false;
    return;
  }
  if (rawKey.byteLength !== KEY_LENGTH_BYTES) throw new Error('The storage key must have 32 bytes');

  cryptoKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
  isWriting = shouldEncryptWrites;
}

export function setAtRestWriting(shouldEncryptWrites: boolean) {
  isWriting = shouldEncryptWrites && Boolean(cryptoKey);
}

export function hasAtRestKey() {
  return Boolean(cryptoKey);
}

/** Whether new records are encrypted */
export function isEncryptingWrites() {
  return isWriting;
}

export function isEncryptedValue(value: unknown): value is EncryptedValue {
  return Boolean(value) && typeof value === 'object' && (value as EncryptedValue).$enc === FORMAT_VERSION
    && isBytes((value as EncryptedValue).iv) && isBytes((value as EncryptedValue).data);
}

/** `context` is bound to the record, so that a record cannot be moved to another place; it is not secret */
export async function encryptValue(context: string, value: unknown): Promise<EncryptedValue> {
  const key = getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: getAdditionalData(context) }, key, encodeValue(value),
  );
  return { $enc: FORMAT_VERSION, iv, data: new Uint8Array(data) };
}

export async function decryptValue(context: string, encrypted: EncryptedValue): Promise<unknown> {
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.iv, additionalData: getAdditionalData(context) }, getKey(), encrypted.data,
  );
  return decodeValue(new Uint8Array(data));
}

export async function encryptBytes(context: string, bytes: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: getAdditionalData(context) }, getKey(), bytes,
  );
  return { iv, data: new Uint8Array(data) };
}

export async function decryptBytes(context: string, iv: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: getAdditionalData(context) }, getKey(), data,
  );
  return new Uint8Array(bytes);
}

function getKey() {
  if (!cryptoKey) throw new StorageLockedError();
  return cryptoKey;
}

function getAdditionalData(context: string) {
  return new TextEncoder().encode(`${AAD_PREFIX}${context}`);
}

/**
 * Serializes a value that IndexedDB can store: `[length of the JSON header][JSON header][bytes of every Uint8Array]`.
 * The header holds the structure, with each `Uint8Array` replaced by its place in the tail, and also covers `bigint`,
 * `Map`, `Set`, `Date`, and numbers that JSON lacks.
 */
export function encodeValue(value: unknown): Uint8Array<ArrayBuffer> {
  const blobs: Uint8Array[] = [];
  let offset = 0;

  function replace(this: unknown, key: string, replaced: unknown) {
    const original = (this as Record<string, unknown>)[key];
    if (isBytes(original)) {
      blobs.push(original);
      const reference = { [TAG_KEY]: TAG_BYTES, o: offset, l: original.length };
      offset += original.length;
      return reference;
    }
    if (ArrayBuffer.isView(original) || original instanceof ArrayBuffer) {
      throw new Error('Only Uint8Array values can be stored encrypted');
    }
    if (typeof original === 'bigint') return { [TAG_KEY]: TAG_BIGINT, v: original.toString() };
    if (original instanceof Map) return { [TAG_KEY]: TAG_MAP, v: [...original.entries()] };
    if (original instanceof Set) return { [TAG_KEY]: TAG_SET, v: [...original.values()] };
    if (original instanceof Date) return { [TAG_KEY]: TAG_DATE, v: original.getTime() };
    if (typeof original === 'number' && !Number.isFinite(original)) {
      return { [TAG_KEY]: TAG_NUMBER, v: String(original) };
    }
    if (original === undefined && Array.isArray(this)) return { [TAG_KEY]: TAG_UNDEFINED };
    if (replaced && typeof replaced === 'object' && !Array.isArray(replaced) && TAG_KEY in replaced) {
      throw new Error(`Stored objects cannot have a ${TAG_KEY} property`);
    }
    return replaced;
  }

  const header = new TextEncoder().encode(JSON.stringify({ v: value }, replace));
  const result = new Uint8Array(HEADER_LENGTH_BYTES + header.length + offset);
  new DataView(result.buffer).setUint32(0, header.length);
  result.set(header, HEADER_LENGTH_BYTES);
  let position = HEADER_LENGTH_BYTES + header.length;
  for (const blob of blobs) {
    result.set(blob, position);
    position += blob.length;
  }
  return result;
}

export function decodeValue(bytes: Uint8Array): unknown {
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const tailStart = HEADER_LENGTH_BYTES + headerLength;
  const header = new TextDecoder().decode(bytes.subarray(HEADER_LENGTH_BYTES, tailStart));

  const revive = (key: string, value: unknown) => {
    if (!value || typeof value !== 'object' || !(TAG_KEY in value)) return value;
    const tagged = value as Record<string, unknown>;
    switch (tagged[TAG_KEY]) {
      case TAG_BYTES: {
        const start = tailStart + (tagged.o as number);
        return bytes.slice(start, start + (tagged.l as number));
      }
      case TAG_BIGINT: return BigInt(tagged.v as string);
      case TAG_MAP: return new Map(tagged.v as [unknown, unknown][]);
      case TAG_SET: return new Set(tagged.v as unknown[]);
      case TAG_DATE: return new Date(tagged.v as number);
      case TAG_NUMBER: return Number(tagged.v);
      case TAG_UNDEFINED: return undefined;
      default: return value;
    }
  };
  return (JSON.parse(header, revive) as { v: unknown }).v;
}

// Not `instanceof`: IndexedDB can hand out arrays of another realm, such as a worker's or a test environment's
function isBytes(value: unknown): value is Uint8Array<ArrayBuffer> {
  return Object.prototype.toString.call(value) === '[object Uint8Array]';
}
