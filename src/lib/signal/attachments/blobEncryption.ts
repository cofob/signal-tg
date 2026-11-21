import { decryptBytes, encryptBytes } from '../store/atRest';

// A cached attachment is `MAGIC`, a random 16-byte file id, then frames of `[length][IV][AES-GCM ciphertext]`: the first
// frame holds the media type, the others up to `CHUNK_BYTES` of the file each. What a frame is bound to: the cache key
// of the file, the file id, the frame's number and whether it is the last. So frames cannot be moved to another file
// or reordered, a cut file does not decrypt, and a file in the clear that begins with the magic is told from an
// encrypted one by the first frame not decrypting.
const MAGIC = new Uint8Array([0x54, 0x53, 0x45, 0x32]); // "TSE2"
const FILE_ID_BYTES = 16;
const HEADER_BYTES = MAGIC.length + FILE_ID_BYTES;
const CHUNK_BYTES = 1 << 20;
const IV_BYTES = 12;
const LENGTH_BYTES = 4;
const ENCRYPTED_MIME_TYPE = 'application/octet-stream';

/** Whether the blob is a file that the current key encrypted for this cache key; the magic alone does not tell */
export async function isEncryptedBlob(blob: Blob, cacheKey: string, hasKey = true) {
  if (blob.size < HEADER_BYTES + LENGTH_BYTES) return false;

  const header = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  if (!MAGIC.every((byte, index) => byte === header[index])) return false;
  // Without the key the magic is all there is to go by
  if (!hasKey) return true;

  try {
    await readTypeFrame(blob, cacheKey, header.subarray(MAGIC.length));
    return true;
  } catch (err) {
    return false;
  }
}

/** Encrypts a file in chunks, so a large video is never held twice in memory */
export async function encryptBlob(blob: Blob, cacheKey: string) {
  const fileId = crypto.getRandomValues(new Uint8Array(FILE_ID_BYTES));
  const parts: BlobPart[] = [MAGIC.slice(), fileId];
  const chunkCount = Math.max(1, Math.ceil(blob.size / CHUNK_BYTES));
  parts.push(await buildFrame(cacheKey, fileId, 0, false, new TextEncoder().encode(blob.type)));
  for (let index = 0; index < chunkCount; index++) {
    const chunk = new Uint8Array(await blob.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).arrayBuffer());
    parts.push(await buildFrame(cacheKey, fileId, index + 1, index === chunkCount - 1, chunk));
  }
  return new Blob(parts, { type: ENCRYPTED_MIME_TYPE });
}

/** Throws when the blob is not an encrypted file of this key and cache key; the type comes from inside the file */
export async function decryptBlob(blob: Blob, cacheKey: string, getSafeType: (type: string) => string) {
  const fileId = new Uint8Array(await blob.slice(MAGIC.length, HEADER_BYTES).arrayBuffer());
  let position = HEADER_BYTES;
  const readFrame = async () => {
    const frame = await readFrameAt(blob, position);
    position = frame.end;
    return frame.bytes;
  };

  const type = new TextDecoder().decode(await decryptFrame(cacheKey, fileId, 0, false, await readFrame()));
  const parts: BlobPart[] = [];
  for (let index = 1; ; index++) {
    const frame = await readFrame();
    const isFinal = position === blob.size;
    parts.push(await decryptFrame(cacheKey, fileId, index, isFinal, frame));
    if (isFinal) break;
  }
  return new Blob(parts, { type: getSafeType(type) });
}

async function readTypeFrame(blob: Blob, cacheKey: string, fileId: Uint8Array) {
  const { bytes } = await readFrameAt(blob, HEADER_BYTES);
  return decryptFrame(cacheKey, fileId, 0, false, bytes);
}

async function readFrameAt(blob: Blob, position: number) {
  if (position + LENGTH_BYTES > blob.size) throw new Error('Truncated encrypted file');
  const length = new DataView(await blob.slice(position, position + LENGTH_BYTES).arrayBuffer()).getUint32(0);
  const start = position + LENGTH_BYTES;
  if (length < IV_BYTES || start + length > blob.size) throw new Error('Malformed encrypted file');
  return { bytes: new Uint8Array(await blob.slice(start, start + length).arrayBuffer()), end: start + length };
}

async function buildFrame(
  cacheKey: string, fileId: Uint8Array, index: number, isLast: boolean, plain: Uint8Array<ArrayBuffer>,
) {
  const { iv, data } = await encryptBytes(getContext(cacheKey, fileId, index, isLast), plain);
  const frame = new Uint8Array(LENGTH_BYTES + iv.length + data.length);
  new DataView(frame.buffer).setUint32(0, iv.length + data.length);
  frame.set(iv, LENGTH_BYTES);
  frame.set(data, LENGTH_BYTES + iv.length);
  return frame;
}

function decryptFrame(
  cacheKey: string, fileId: Uint8Array, index: number, isLast: boolean, frame: Uint8Array<ArrayBuffer>,
) {
  return decryptBytes(getContext(cacheKey, fileId, index, isLast), frame.slice(0, IV_BYTES), frame.slice(IV_BYTES));
}

function getContext(cacheKey: string, fileId: Uint8Array, index: number, isLast: boolean) {
  const id = Array.from(fileId, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `blob|${cacheKey}|${id}|${index}|${isLast ? 1 : 0}`;
}
