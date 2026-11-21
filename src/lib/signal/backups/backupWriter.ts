import { toBinary } from '@bufbuild/protobuf';
import { Gzip } from 'fflate';

import type { Frame } from '../proto/generated/Backup_pb';
import type { MessageBackupKeys } from './backupStream';

import { concat } from '../../../util/encoding/buffer';
import { getRandomBytes, hmacSha256 } from '../crypto';
import { wasm } from '../wasm';
import { FORWARD_SECRECY_MAGIC } from './backupStream';

import { FrameSchema } from '../proto/generated/Backup_pb';

export type BackupFileResult = {
  // `[SBACKUP\x01 || metadata] || IV || AES-256-CBC(gzip(frames) || zero padding) || HMAC-SHA256`
  file: Uint8Array<ArrayBuffer>;
  // The size of the delimited frames, which the next backup takes as its estimate
  uncompressedLength: number;
};

type WriteOptions = {
  // The `uncompressedLength` of the previous backup; the flush intervals of the compression follow it
  estimatedUncompressedLength?: number;
  // The metadata of SVR-B for a backup on the archive CDN, which goes at the start of the file; the keys then derive
  // from its token. A local file has none.
  forwardSecrecyMetadata?: Uint8Array;
  // Called with the frames written so far
  onProgress?: (frameCount: number) => void;
};

// The IV, the cipher blocks and the MAC of `readBackupFrames`
const IV_LENGTH = 16;
const MAC_LENGTH = 32;
const AES_BLOCK_SIZE = 16;
// A multiple of `AES_BLOCK_SIZE`
const ENCRYPT_CHUNK_SIZE = 1024 * 1024;
const VARINT_PAYLOAD_BITS = 7;
const VARINT_PAYLOAD_MASK = 0x7f;
const VARINT_CONTINUATION_BIT = 0x80;

/**
 * Writes the encrypted backup file (Signal Desktop `toPaddedGzipIterable` in `ts/services/backups/encoding.node.ts`
 * and `#runExport` in `ts/services/backups/index.preload.ts`, Signal Android `EncryptedBackupWriter`, whose
 * `createForSignalBackup` writes `SBACKUP\x01` and the metadata first). `info` is the serialized `BackupInfo`. Each frame goes in with a varint length prefix, the
 * whole is gzipped with a block boundary around the account data and the recipients and at the flush intervals of
 * libsignal inside the chat items, followed by zero padding sized by libsignal, then encrypted with AES-256-CBC
 * under a random IV, and a MAC over the IV and the ciphertext ends the file.
 */
export async function writeBackupFile(
  info: Uint8Array,
  frames: AsyncIterable<Frame>,
  keys: MessageBackupKeys,
  options: WriteOptions = {},
): Promise<BackupFileResult> {
  const { compressed, uncompressedLength } = await compressFrames(info, frames, options);
  const iv = getRandomBytes(IV_LENGTH);
  const ciphertext = await encryptAesCbcInChunks(compressed, keys.aesKey, iv);

  // The MAC covers the IV and the ciphertext, not the header
  const header = options.forwardSecrecyMetadata
    ? concat(FORWARD_SECRECY_MAGIC, delimit(options.forwardSecrecyMetadata)) : new Uint8Array(0);
  const macStart = header.length;
  const macOffset = macStart + iv.length + ciphertext.length;
  const file = new Uint8Array(macOffset + MAC_LENGTH);
  file.set(header, 0);
  file.set(iv, macStart);
  file.set(ciphertext, macStart + iv.length);
  file.set(await hmacSha256(keys.hmacKey, file.subarray(macStart, macOffset)), macOffset);
  return { file, uncompressedLength };
}

/** Compresses the delimited frames and appends the padding that libsignal sizes (see `MessageBackupSizing_*`) */
async function compressFrames(
  info: Uint8Array,
  frames: AsyncIterable<Frame>,
  { estimatedUncompressedLength, onProgress }: WriteOptions,
) {
  const estimate = BigInt(estimatedUncompressedLength ?? 0);
  const output: Uint8Array[] = [];
  let compressedLength = 0;
  const gzip = new Gzip((chunk) => {
    output.push(chunk.slice());
    compressedLength += chunk.length;
  });

  let pending: Uint8Array[] = [];
  let uncompressedLength = 0;
  const write = (bytes: Uint8Array) => {
    pending.push(bytes);
    uncompressedLength += bytes.length;
  };
  // Hands the compressor what has been written, so that it ends its block there when the data fills one. A sync flush,
  // which would end the block exactly here, produces a stream that gunzip rejects when the block is stored (fflate 0.8).
  const flush = () => {
    if (pending.length) gzip.push(concat(...pending));
    pending = [];
    gzip.flush();
  };

  // The largest block of chat items, in uncompressed bytes, which sizes the padding
  let largestBlock = 0;
  let currentBlock = 0;
  const endBlock = () => {
    largestBlock = Math.max(largestBlock, currentBlock);
    currentBlock = 0;
  };

  write(delimit(info));
  flush();

  // Chat item bytes at which the block ends; libsignal picks the interval from the position
  let chatItemBytes = 0;
  let flushOffset = chatItemBytes + Number(wasm.MessageBackupSizing_FlushInterval(BigInt(chatItemBytes), estimate));
  let frameCount = 0;

  for await (const item of frames) {
    const kind = item.item.case;
    let isFlushedAround = kind === 'account' || kind === 'recipient';
    const isChatItem = kind === 'chatItem';
    if (!chatItemBytes && isChatItem) {
      // The chat items start in a block of their own
      flush();
    } else if (chatItemBytes && !isChatItem) {
      // A frame between chat items, such as a recipient that a chat item names for the first time
      isFlushedAround = true;
      endBlock();
    }
    if (isFlushedAround) flush();

    let frame = delimit(toBinary(FrameSchema, item));
    if (!isChatItem) {
      write(frame);
    } else {
      // A frame that crosses the end of a block is cut there
      while (frame.length) {
        const slice = frame.subarray(0, flushOffset - chatItemBytes);
        write(slice);
        chatItemBytes += slice.length;
        currentBlock += slice.length;
        if (slice.length === frame.length) break;

        frame = frame.subarray(slice.length);
        flushOffset = chatItemBytes + Number(wasm.MessageBackupSizing_FlushInterval(BigInt(chatItemBytes), estimate));
        endBlock();
        flush();
      }
    }
    if (isFlushedAround) flush();
    frameCount++;
    onProgress?.(frameCount);
  }
  endBlock();

  gzip.push(concat(...pending), true);
  pending = [];

  const paddingLength = Number(wasm.MessageBackupSizing_PaddingSize(BigInt(largestBlock), BigInt(compressedLength)));
  return { compressed: concat(...output, new Uint8Array(paddingLength)), uncompressedLength };
}

/** AES-256-CBC with PKCS#7 padding; WebCrypto takes the message whole, so each chunk continues from the last block */
async function encryptAesCbcInChunks(
  data: Uint8Array<ArrayBuffer>, aesKey: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>,
) {
  const key = await crypto.subtle.importKey('raw', aesKey, 'AES-CBC', false, ['encrypt']);
  const output: Uint8Array[] = [];
  let chunkIv = iv;

  for (let offset = 0; offset < data.length; offset += ENCRYPT_CHUNK_SIZE) {
    const end = Math.min(offset + ENCRYPT_CHUNK_SIZE, data.length);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: chunkIv }, key, data.subarray(offset, end),
    ));
    if (end === data.length) {
      output.push(encrypted);
      break;
    }
    // Every chunk but the last is a whole number of blocks, and WebCrypto adds a block of padding after it, which
    // the next chunk replaces
    const ciphertext = encrypted.subarray(0, end - offset);
    output.push(ciphertext);
    chunkIv = ciphertext.subarray(ciphertext.length - AES_BLOCK_SIZE);
  }
  if (!data.length) {
    output.push(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, data)));
  }
  return concat(...output);
}

/** The frame with its length as a protobuf varint in front, which is how `readBackupFrames` reads them */
function delimit(bytes: Uint8Array) {
  const prefix: number[] = [];
  let length = bytes.length;
  while (length >= VARINT_CONTINUATION_BIT) {
    prefix.push((length & VARINT_PAYLOAD_MASK) | VARINT_CONTINUATION_BIT);
    length = Math.floor(length / 2 ** VARINT_PAYLOAD_BITS);
  }
  prefix.push(length);
  return concat(new Uint8Array(prefix), bytes);
}
