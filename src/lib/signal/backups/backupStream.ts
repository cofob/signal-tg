import { concat } from '../../../util/encoding/buffer';
import { pause } from '../../../util/schedulers';
import { verifyHmacSha256 } from '../crypto';
import { wasm } from '../wasm';

export type MessageBackupKeys = {
  hmacKey: Uint8Array<ArrayBuffer>;
  aesKey: Uint8Array<ArrayBuffer>;
};

type OnProgress = (readLength: number, totalLength: number) => void;

// Signal Android `EncryptedBackupWriter.MAGIC_NUMBER`: backups on the archive CDN start with it, followed by the
// metadata of forward secrecy (with a varint length) that SVR-B needs to give the token for the keys
export const FORWARD_SECRECY_MAGIC = new TextEncoder().encode('SBACKUP\x01');
const IV_LENGTH = 16;
const MAC_LENGTH = 32;
const AES_BLOCK_SIZE = 16;
// A multiple of `AES_BLOCK_SIZE`
const DECRYPT_CHUNK_SIZE = 1024 * 1024;
const VARINT_PAYLOAD_BITS = 7;
const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_CONTINUATION_BIT = 0x80;
// Frame lengths fit in 32 bits (Signal Desktop `ts/util/DelimitedStream.node.ts`)
const MAX_VARINT_LENGTH = 5;
// The gzip trailer ends with the uncompressed size modulo 2^32, as a little-endian 32-bit number
const GZIP_SIZE_LENGTH = 4;
const UINT32_RANGE = 2 ** 32;
const MAX_BUFFERED_OUTPUT = 4 * 1024 * 1024;
// libsignal `forward_secrecy.rs` `MAX_METADATA_LEN`: a valid metadata, two pairs and an IV, is a few hundred bytes
const MAX_METADATA_LENGTH = 16 * 1024;
// A frame is a chat item or a recipient, which are small next to this. These caps stop a corrupted or malicious file
// from taking the memory of the tab: it is the length prefix that says how much a frame takes, and the compression
// ratio of text that says how much a small file inflates to.
const MAX_FRAME_LENGTH = 16 * 1024 * 1024;
const MAX_UNCOMPRESSED_LENGTH = 2 * 1024 * 1024 * 1024;

/** The forward secrecy header at the start of a backup is cut short or too large */
export class BackupHeaderError extends Error {
  constructor() {
    super('Backup has an invalid forward secrecy header');
  }
}

/**
 * Derives the keys of a backup from its backup key and our ACI; link and sync uses the ephemeral backup key
 * from the provisioning message (Signal Desktop `getMessageBackupKey` in `ts/services/backups/crypto.preload.ts`).
 * The backups on the archive CDN also take the token that SVR-B gives (`forwardSecrecyToken`).
 */
export function deriveMessageBackupKeys(
  backupKey: Uint8Array, aci: string, forwardSecrecyToken?: Uint8Array,
): MessageBackupKeys {
  const backupId = wasm.BackupKey_DeriveBackupId(backupKey, wasm.ServiceId_ParseFromServiceIdString(aci));
  const key = wasm.MessageBackupKey_FromBackupKeyAndBackupId(backupKey, backupId, forwardSecrecyToken);
  return {
    hmacKey: new Uint8Array(wasm.MessageBackupKey_GetHmacKey(key)),
    aesKey: new Uint8Array(wasm.MessageBackupKey_GetAesKey(key)),
  };
}

/**
 * Reads the frames of an encrypted backup: `IV || AES-256-CBC(gzip(frames) || zero padding) || HMAC-SHA256` over
 * the IV and the ciphertext (Signal Desktop `importBackup` in `ts/services/backups/index.preload.ts`, Signal Android
 * `EncryptedBackupWriter`), after the forward secrecy header of a backup from the archive CDN if there is one. The MAC
 * of a file without the header covers all bytes before it, as libsignal `FramesReader` reads that legacy format. The
 * MAC is checked before anything is decrypted. Each frame is a protobuf with a varint length prefix; the first is
 * `BackupInfo`. `onProgress` follows the decrypted bytes.
 */
export async function* readBackupFrames(
  archive: Uint8Array<ArrayBuffer>, keys: MessageBackupKeys, onProgress?: OnProgress,
): AsyncGenerator<Uint8Array> {
  const start = readForwardSecrecyHeader(archive)?.end ?? 0;
  if (archive.length < start + IV_LENGTH + AES_BLOCK_SIZE + MAC_LENGTH) throw new Error('Backup is too short');

  const macOffset = archive.length - MAC_LENGTH;
  await verifyHmacSha256(archive.subarray(start, macOffset), keys.hmacKey, archive.subarray(macOffset), MAC_LENGTH);

  const iv = archive.subarray(start, start + IV_LENGTH);
  const ciphertext = archive.subarray(start + IV_LENGTH, macOffset);
  const decoder = new PaddedGzipDecoder(decryptAesCbcChunks(keys.aesKey, iv, ciphertext, onProgress));
  yield* readDelimitedFrames(decoder.read());
}

/**
 * The forward secrecy metadata at the start of a backup from the archive CDN (`SBACKUP\x01`, the length as a varint
 * and the bytes of the metadata), which SVR-B takes to give the token of the file. `undefined` for a file without it.
 * `bytes` may be the start of the file, as long as it has the whole header.
 */
export function readForwardSecrecyMetadata(bytes: Uint8Array) {
  const header = readForwardSecrecyHeader(bytes);
  return header && bytes.subarray(header.metadataStart, header.end);
}

export function hasForwardSecrecyHeader(bytes: Uint8Array) {
  return bytes.length >= FORWARD_SECRECY_MAGIC.length
    && FORWARD_SECRECY_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** `end` is where the IV starts; a header that is cut short or too large is an error */
function readForwardSecrecyHeader(bytes: Uint8Array) {
  if (!hasForwardSecrecyHeader(bytes)) return undefined;
  const prefix = readVarint(bytes, FORWARD_SECRECY_MAGIC.length);
  if (!prefix || prefix.value > MAX_METADATA_LENGTH || prefix.end + prefix.value > bytes.length) {
    throw new BackupHeaderError();
  }
  return { metadataStart: prefix.end, end: prefix.end + prefix.value };
}

/** Decrypts AES-256-CBC in chunks, so the plaintext never exists in one piece */
async function* decryptAesCbcChunks(
  aesKey: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: Uint8Array<ArrayBuffer>,
  onProgress?: OnProgress,
) {
  if (ciphertext.length % AES_BLOCK_SIZE) throw new Error('Backup ciphertext is not a whole number of blocks');
  const key = await crypto.subtle.importKey('raw', aesKey, 'AES-CBC', false, ['encrypt', 'decrypt']);

  let chunkIv = iv;
  for (let offset = 0; offset < ciphertext.length; offset += DECRYPT_CHUNK_SIZE) {
    const end = Math.min(offset + DECRYPT_CHUNK_SIZE, ciphertext.length);
    const chunk = ciphertext.subarray(offset, end);
    if (end === ciphertext.length) {
      // The last chunk ends with the PKCS#7 padding, which WebCrypto removes
      yield new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: chunkIv }, key, chunk));
    } else {
      // WebCrypto expects PKCS#7 padding after every input. Encrypting an empty input under the chunk's last
      // ciphertext block gives exactly that padding block, so the chunk decrypts as a complete message.
      const lastBlock = chunk.subarray(chunk.length - AES_BLOCK_SIZE);
      const paddingBlock = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-CBC', iv: lastBlock }, key, new Uint8Array(0)),
      );
      yield new Uint8Array(await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: chunkIv }, key, concat(chunk, paddingBlock),
      ));
      chunkIv = lastBlock;
    }
    onProgress?.(end, ciphertext.length);
  }
}

/**
 * Gunzips with `DecompressionStream`. Signal Android appends zero padding to the gzip data
 * (`PaddedGzipOutputStream`), and `DecompressionStream` fails on any byte after the end of the compressed data.
 * So the zeros at the end are held back: all bytes up to the last nonzero one go in as they come, which includes
 * all compressed data, since the gzip trailer ends with the uncompressed size and that has a nonzero byte. Then
 * single zeros go in until the stream ends or fails on the padding. The output is read as it comes, so a failure
 * loses none of it, and the end is accepted only when the size in the trailer matches the output.
 */
class PaddedGzipDecoder {
  private output: Uint8Array[] = [];

  private bufferedLength = 0;

  private outputLength = 0;

  // The last bytes before the zeros at the end, and the number of those zeros written so far
  private tail?: { lastBytes: Uint8Array; zeroCount: number };

  private isDone = false;

  private error?: Error;

  private waiters: NoneToVoidFunction[] = [];

  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(chunks: AsyncIterable<Uint8Array<ArrayBuffer>>) {
    const stream = new DecompressionStream('gzip');
    this.reader = stream.readable.getReader();
    void this.readOutput();
    this.writeInput(stream.writable.getWriter(), chunks).catch((err: Error) => this.finish(err));
  }

  async* read() {
    try {
      for (;;) {
        const chunk = this.output.shift();
        if (chunk) {
          this.bufferedLength -= chunk.length;
          this.wake();
          yield chunk;
        } else if (this.error) {
          throw this.error;
        } else if (this.isDone) {
          return;
        } else {
          await this.waitForChange();
        }
      }
    } finally {
      this.reader.cancel().catch(() => undefined);
    }
  }

  private async writeInput(
    writer: WritableStreamDefaultWriter<BufferSource>, chunks: AsyncIterable<Uint8Array<ArrayBuffer>>,
  ) {
    let zeroCount = 0;
    let lastBytes = new Uint8Array(0);
    for await (const chunk of chunks) {
      const dataEnd = chunk.findLastIndex((byte) => byte !== 0) + 1;
      if (!dataEnd) {
        zeroCount += chunk.length;
        continue;
      }
      while (this.bufferedLength > MAX_BUFFERED_OUTPUT && !this.isDone) await this.waitForChange();
      if (zeroCount) await writer.write(new Uint8Array(zeroCount));
      const data = chunk.subarray(0, dataEnd);
      await writer.write(data);
      lastBytes = (data.length < GZIP_SIZE_LENGTH ? concat(lastBytes, data) : data).slice(-GZIP_SIZE_LENGTH);
      zeroCount = chunk.length - dataEnd;
    }

    this.tail = { lastBytes, zeroCount: 0 };
    // One more zero than the size can end with covers the end; some streams report the failure one write later
    for (let i = 0; i < Math.min(zeroCount, GZIP_SIZE_LENGTH + 1) && !this.isDone; i++) {
      try {
        await writer.write(new Uint8Array(1));
      } catch {
        // The output reader gets the same failure
        return;
      }
      this.tail.zeroCount++;
      // Lets the output and a failure on this byte arrive before the next one
      await pause(0);
    }
    if (!this.isDone) await writer.close().catch(() => undefined);
  }

  private async readOutput() {
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) break;
        this.output.push(value);
        this.bufferedLength += value.length;
        this.outputLength += value.length;
        if (this.outputLength > MAX_UNCOMPRESSED_LENGTH) {
          this.finish(new Error('Backup is too large to import'));
          return;
        }
        this.wake();
      }
    } catch (err) {
      if (!this.hasTrailerSize()) {
        this.finish(err as Error);
        return;
      }
    }
    if (this.tail && !this.hasTrailerSize()) {
      this.finish(new Error('Backup size does not match the gzip trailer'));
      return;
    }
    this.finish();
  }

  /** Whether the output length is the size in the trailer for some number of the zeros written */
  private hasTrailerSize() {
    if (!this.tail) return false;
    const { lastBytes, zeroCount } = this.tail;
    for (let count = 0; count <= zeroCount; count++) {
      const bytes = concat(lastBytes, new Uint8Array(count)).subarray(-GZIP_SIZE_LENGTH);
      const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.length).getUint32(0, true);
      if (bytes.length === GZIP_SIZE_LENGTH && size === this.outputLength % UINT32_RANGE) return true;
    }
    return false;
  }

  private finish(error?: Error) {
    if (this.isDone) return;
    this.isDone = true;
    this.error = error;
    this.wake();
  }

  private waitForChange() {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private wake() {
    const { waiters } = this;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

async function* readDelimitedFrames(chunks: AsyncIterable<Uint8Array>) {
  let buffer: Uint8Array = new Uint8Array(0);
  for await (const chunk of chunks) {
    buffer = buffer.length ? concat(buffer, chunk) : chunk;
    let offset = 0;
    for (;;) {
      const prefix = readVarint(buffer, offset);
      if (prefix && prefix.value > MAX_FRAME_LENGTH) throw new Error('Backup frame is too long');
      if (!prefix || prefix.end + prefix.value > buffer.length) break;
      offset = prefix.end + prefix.value;
      yield buffer.subarray(prefix.end, offset);
    }
    buffer = buffer.subarray(offset);
  }
  if (buffer.length) throw new Error('Backup ends inside a frame');
}

/** Returns `undefined` when the buffer ends inside the varint */
function readVarint(buffer: Uint8Array, offset: number) {
  let value = 0;
  for (let i = 0; i < MAX_VARINT_LENGTH; i++) {
    if (offset + i >= buffer.length) return undefined;
    const byte = buffer[offset + i];
    value += (byte & VARINT_PAYLOAD_MASK) * 2 ** (VARINT_PAYLOAD_BITS * i);
    if (!(byte & VARINT_CONTINUATION_BIT)) return { value, end: offset + i + 1 };
  }
  throw new Error('Backup frame length is too long');
}
