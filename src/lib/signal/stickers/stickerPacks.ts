import { fromBinary } from '@bufbuild/protobuf';

import type SignalStore from '../store/SignalStore';

import { SIGNAL_CDN_HOSTS } from '../config';
import * as cacheApi from '../../../util/cacheApi';
import { bufferFromBase64, bufferFromHex, bufferToHex } from '../../../util/encoding/buffer';
import { ATTACHMENT_CACHE_NAME } from '../attachments/attachmentCache';
import { decryptAttachment } from '../attachments/attachmentCrypto';
import { deriveSecrets, encodeUtf8 } from '../crypto';
import { sendHttpRequest } from '../net/http';
import { getIsStickerPackValid } from './stickerPackLinks';

import { PackSchema } from '../proto/generated/StickerResources_pb';

/** A sticker of a pack manifest */
export type StickerPackSticker = {
  id: number;
  emoji: string;
};

/** The decrypted manifest of a sticker pack */
export type StickerPackManifest = {
  title: string;
  author: string;
  coverStickerId: number;
  stickers: StickerPackSticker[];
};

/**
 * Whether a sticker pack is installed here. Ids and keys are hex, as in Signal Desktop's database. A removed pack
 * keeps `uninstalledAt` for its storage service record.
 */
export type StickerPackRecord = {
  id: string;
  key: string;
  // Installed packs only; packs show by ascending `position`, then by id
  installedAt?: number;
  position?: number;
  uninstalledAt?: number;
};

// The CDN that serves sticker packs (Signal Desktop `getStickerPackManifest` in `ts/textsecure/WebAPI.preload.ts`)
const STICKER_CDN = 0;
const DERIVED_KEY_LENGTH = 64;
const SALT_LENGTH = 32;
const PACK_KEY_INFO = encodeUtf8('Sticker Pack');
// Signal Desktop `ts/types/AttachmentSize.std.ts`
const MAX_CIPHERTEXT_LENGTH = 1024 * 1024;
// Signal Desktop `MAX_STICKERS_PER_PACK` in `ts/util/Stickers.std.ts`
const MAX_STICKERS_PER_PACK = 1024;
const HTTP_OK = 200;
// The sticker CDN answers 403 for a pack that does not exist, as CDN 0 does for attachments
const HTTP_NOT_FOUND_STATUSES = new Set([403, 404]);
const DEFAULT_CONTENT_TYPE = 'image/webp';
const PNG_CONTENT_TYPE = 'image/png';
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

/**
 * Packs from Signal's artist series, which Signal Desktop offers to install (`BLESSED_PACKS` in
 * `ts/types/Stickers.preload.ts`). Keys are base64 as in the source.
 */
const KNOWN_PACKS: Record<string, string> = {
  '42fb75e1827c0c945cfb5ca0975db03c': '7uJ+K593PgpV6iTDQLe+hYcRpuK9m27nBEND4OQovmU=',
  ccc89a05dc077856b57351e90697976c: 'RXMOYPCdVWYRUiN0RTemt9nqmc7qy3eh+9aAG5YH+88=',
  fb535407d2f6497ec074df8b9c51dd1d: 'F+lxwTQDViJ4HS7iSeZHO3dFg3ULaMEbuCt1CcaLbf0=',
  '3044281a51307306e5442f2e9070953a': 'xMqqhDl+GmMKWWD1SguCdTyIpeUuDe/mFbpN2A8TDL8=',
  a2414255948558316f37c1d36c64cd28: '/aEpNxltI28cqeEZalZULh0c72/4TivgOChxf6IK02Y=',
  '684d2b7bcfc2eec6f57f2e7be0078e0f': 'hm4Ny0obJfKwTfJwzXQnI+SmVVwKGrw/PzDcxaIBDFU=',
  f19548e5afa38d1ce4f5c3191eba5e30: 'LLMHZ0D2aapExsBjKQskmn0ApLAu2PnppbkCo38bvEE=',
  '9acc9e8aba563d26a4994e69263e3b25': 'Wm3/OUjCjvubeq+T7MN1xp/DFueAd+0mhnoU0QoPahI=',
  e61fa0867031597467ccc036cc65d403: 'E657GnQHMYKA6bOMEmHe044OcTi5+WSmzLtz5A9zeps=',
  cca32f5b905208b7d0f1e17f23fdc185: 'i/jpX3pFver+DI9bAC7wGrlbjxtbqsQBnM1ra+Cxg3o=',
  cfc50156556893ef9838069d3890fe49: 'X1vqt9OCRDywCh5I65Upe2uMrf0GMeXQ2dyUnmmZ/0s=',
};

/** Signal's artist series packs with hex keys */
export function getKnownStickerPacks() {
  return Object.entries(KNOWN_PACKS).map(([id, key]) => ({ id, key: bufferToHex(bufferFromBase64(key)) }));
}

/** The CDN has no such pack, or the pack key does not decrypt it */
export class StickerPackNotFoundError extends Error {}

/** The manifest of a pack, downloaded and stored on first use */
export async function fetchStickerPackManifest(store: SignalStore, id: string, key: string) {
  const stored = await store.getStickerPackManifest(id);
  if (stored) return stored;

  const manifest = await downloadStickerPackManifest(id, key);
  await store.setStickerPackManifest(id, manifest);
  return manifest;
}

/**
 * Downloads and decrypts a pack manifest: `cdn.signal.org/stickers/<id>/manifest.proto`, encrypted like attachments
 * with keys derived from the pack key (Signal Desktop `downloadStickerPack` and `parseStickerPackManifest` in
 * `ts/types/Stickers.preload.ts`). Packs keep at most `MAX_STICKERS_PER_PACK` stickers; a pack without a cover and
 * stickers is malformed.
 */
export async function downloadStickerPackManifest(id: string, key: string): Promise<StickerPackManifest> {
  const plaintext = await downloadStickerPackFile(id, key, 'manifest.proto');
  const pack = fromBinary(PackSchema, plaintext);
  const stickers = pack.stickers.slice(0, MAX_STICKERS_PER_PACK)
    .map(({ id: stickerId, emoji }) => ({ id: stickerId, emoji }));
  const cover = pack.cover ?? stickers[0];
  if (!cover) throw new Error('Sticker pack has no cover and no stickers');
  return {
    title: pack.title,
    author: pack.author,
    coverStickerId: cover.id,
    stickers,
  };
}

/**
 * The image of a sticker, decrypted, from the attachment cache or the CDN (`/stickers/<id>/full/<stickerId>`).
 * Manifests call every sticker WebP, while some packs hold APNG files, so the type comes from the file.
 */
export async function fetchStickerImage(id: string, key: string, stickerId: number) {
  const cacheKey = `sticker/${id}/${stickerId}`;
  const cached: Blob | undefined = await cacheApi.fetch(ATTACHMENT_CACHE_NAME, cacheKey, cacheApi.Type.Blob);
  if (cached) return cached;

  const plaintext = await downloadStickerPackFile(id, key, `full/${stickerId}`);
  const blob = new Blob([plaintext], { type: getStickerContentType(plaintext) });
  await cacheApi.save(ATTACHMENT_CACHE_NAME, cacheKey, blob);
  return blob;
}

/** Orders installed packs as the storage service record describes: by position, then by id */
export function sortInstalledStickerPacks(packs: StickerPackRecord[]) {
  return packs
    .filter(({ installedAt }) => installedAt !== undefined)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id));
}

/** The position of a newly installed pack: after every known one (`InstalledStickerPackRecord.position`) */
export function getNextStickerPackPosition(packs: StickerPackRecord[]) {
  return Math.max(-1, ...packs.map(({ position }) => position ?? -1)) + 1;
}

/** PNG (APNG for animated stickers) by its signature, WebP otherwise */
export function getStickerContentType(data: Uint8Array) {
  return PNG_SIGNATURE.every((byte, i) => data[i] === byte) ? PNG_CONTENT_TYPE : DEFAULT_CONTENT_TYPE;
}

async function downloadStickerPackFile(id: string, key: string, file: string) {
  if (!getIsStickerPackValid(id, key)) throw new Error('Invalid sticker pack');

  const controller = new AbortController();
  const response = await sendHttpRequest(SIGNAL_CDN_HOSTS[STICKER_CDN], {
    method: 'GET',
    path: `/stickers/${id}/${file}`,
    signal: controller.signal,
    onReceiveProgress: (receivedLength, totalLength) => {
      if (Math.max(receivedLength, totalLength) > MAX_CIPHERTEXT_LENGTH) {
        controller.abort(new Error(`Sticker pack file is larger than ${MAX_CIPHERTEXT_LENGTH} bytes`));
      }
    },
  });
  if (HTTP_NOT_FOUND_STATUSES.has(response.status)) throw new StickerPackNotFoundError(`HTTP ${response.status}`);
  if (response.status !== HTTP_OK) throw new Error(`Sticker pack download failed with HTTP ${response.status}`);
  // Progress has no total without `Content-Length`, so the length is checked again here
  if (response.body.length > MAX_CIPHERTEXT_LENGTH) {
    throw new Error(`Sticker pack file is larger than ${MAX_CIPHERTEXT_LENGTH} bytes`);
  }

  const derivedKey = deriveSecrets(DERIVED_KEY_LENGTH, bufferFromHex(key), PACK_KEY_INFO, new Uint8Array(SALT_LENGTH));
  try {
    return await decryptAttachment(response.body, derivedKey);
  } catch (err) {
    throw new StickerPackNotFoundError('The pack key does not decrypt the pack', { cause: err });
  }
}
