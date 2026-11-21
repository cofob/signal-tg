import { decryptBytes, encryptBytes } from '../store/atRest';

// A cached attachment is `MAGIC`, then frames of `[length][IV][AES-GCM ciphertext]`: the first frame holds the media
// type, the others up to `CHUNK_BYTES` of the file each. A frame's number and whether it is the last are authenticated,
// so frames cannot be reordered and a cut file does not decrypt.
const MAGIC = new Uint8Array([0x54, 0x53, 0x45, 0x31]); // "TSE1"
const CHUNK_BYTES = 1 << 20;
const IV_BYTES = 12;
const LENGTH_BYTES = 4;
const ENCRYPTED_MIME_TYPE = 'application/octet-stream';

export async function isEncryptedBlob(blob: Blob) {
  if (blob.size < MAGIC.length) return false;
  const start = new Uint8Array(await blob.slice(0, MAGIC.length).arrayBuffer());
  return MAGIC.every((byte, index) => byte === start[index]);
}

/** Encrypts a file in chunks, so a large video is never held twice in memory */
export async function encryptBlob(blob: Blob) {
  const parts: BlobPart[] = [MAGIC.slice()];
  const chunkCount = Math.max(1, Math.ceil(blob.size / CHUNK_BYTES));
  parts.push(await buildFrame(0, false, new TextEncoder().encode(blob.type)));
  for (let index = 0; index < chunkCount; index++) {
    const chunk = new Uint8Array(await blob.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).arrayBuffer());
    parts.push(await buildFrame(index + 1, index === chunkCount - 1, chunk));
  }
  return new Blob(parts, { type: ENCRYPTED_MIME_TYPE });
}

/** Throws when the blob is not an encrypted file of this key; the type comes from inside the file */
export async function decryptBlob(blob: Blob, getSafeType: (type: string) => string) {
  let position = MAGIC.length;
  const readFrame = async () => {
    if (position + LENGTH_BYTES > blob.size) throw new Error('Truncated encrypted file');
    const length = new DataView(await blob.slice(position, position + LENGTH_BYTES).arrayBuffer()).getUint32(0);
    const start = position + LENGTH_BYTES;
    if (length < IV_BYTES || start + length > blob.size) throw new Error('Malformed encrypted file');
    position = start + length;
    return new Uint8Array(await blob.slice(start, position).arrayBuffer());
  };

  const typeFrame = await readFrame();
  const type = new TextDecoder().decode(await decryptFrame(0, false, typeFrame));
  const parts: BlobPart[] = [];
  for (let index = 1; ; index++) {
    const frame = await readFrame();
    const isFinal = position === blob.size;
    parts.push(await decryptFrame(index, isFinal, frame));
    if (isFinal) break;
  }
  return new Blob(parts, { type: getSafeType(type) });
}

async function buildFrame(index: number, isLast: boolean, plain: Uint8Array<ArrayBuffer>) {
  const { iv, data } = await encryptBytes(getContext(index, isLast), plain);
  const frame = new Uint8Array(LENGTH_BYTES + iv.length + data.length);
  new DataView(frame.buffer).setUint32(0, iv.length + data.length);
  frame.set(iv, LENGTH_BYTES);
  frame.set(data, LENGTH_BYTES + iv.length);
  return frame;
}

function decryptFrame(index: number, isLast: boolean, frame: Uint8Array<ArrayBuffer>) {
  return decryptBytes(getContext(index, isLast), frame.slice(0, IV_BYTES), frame.slice(IV_BYTES));
}

function getContext(index: number, isLast: boolean) {
  return `blob|${index}|${isLast ? 1 : 0}`;
}
