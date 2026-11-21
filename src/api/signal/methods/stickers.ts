import type { StickerPackRecord } from '../../../lib/signal/stickers/stickerPacks';
import type { ApiSticker, ApiStickerSet, ApiStickerSetInfo } from '../../types';

import { getIsStickerPackValid } from '../../../lib/signal/stickers/stickerPackLinks';
import {
  fetchStickerPackManifest, getKnownStickerPacks, sortInstalledStickerPacks, StickerPackNotFoundError,
} from '../../../lib/signal/stickers/stickerPacks';
import {
  buildApiPackSticker, buildApiStickerSet, buildApiStickerSetStub, parsePackStickerId,
} from '../builders/stickers';
import { logError, processor, store } from '../engine';

// Signal Desktop `getRecentStickers` in `ts/sql/Server.node.ts`
const RECENT_STICKERS_LIMIT = 24;
// The app reports this error of `fetchStickers` as a pack that does not exist
const STICKER_SET_INVALID_ERROR = 'STICKERSET_INVALID';
// The app keeps the lists after the first load; installs and removals arrive as `updateStickerSet`
const LIST_HASH = 'signal';

/** Installed sticker packs in their storage service order, with their stickers */
export async function fetchStickerSets({ hash }: { hash?: string }) {
  if (hash) return undefined;
  const packs = sortInstalledStickerPacks(Object.values(await store.getItem('stickerPacks') ?? {}));
  return { hash: LIST_HASH, sets: await Promise.all(packs.map(buildInstalledStickerSet)) };
}

/** An installed pack with its stickers, or without them while its manifest cannot be loaded */
export async function buildInstalledStickerSet(pack: StickerPackRecord) {
  try {
    const manifest = await fetchStickerPackManifest(store, pack.id, pack.key);
    return buildApiStickerSet(pack.id, pack.key, manifest, pack).set;
  } catch (err) {
    logError(err);
    return buildApiStickerSetStub(pack);
  }
}

/** Signal's artist series packs, which the sticker picker offers to install */
export async function fetchFeaturedStickers({ hash }: { hash?: string }) {
  if (hash) return undefined;
  const installed = await store.getItem('stickerPacks') ?? {};
  const sets = await Promise.all(getKnownStickerPacks().map(async ({ id, key }) => {
    try {
      const manifest = await fetchStickerPackManifest(store, id, key);
      return buildApiStickerSet(id, key, manifest, installed[id]).set;
    } catch (err) {
      logError(err);
      return undefined;
    }
  }));
  return { hash: LIST_HASH, isPremium: false, sets: sets.filter(isStickerSet) };
}

/**
 * A pack by id and key, as stickers and links name it; a short name is the id of a pack this device knows. A pack
 * the CDN does not have is reported as invalid, other failures as they are, so the app can try again.
 */
export async function fetchStickers({ stickerSetInfo }: { stickerSetInfo: ApiStickerSetInfo }) {
  if ('isMissing' in stickerSetInfo) return undefined;
  const packs = await store.getItem('stickerPacks') ?? {};
  const id = 'id' in stickerSetInfo ? stickerSetInfo.id : stickerSetInfo.shortName;
  const key = 'id' in stickerSetInfo
    ? stickerSetInfo.accessHash
    : packs[id]?.key ?? getKnownStickerPacks().find((pack) => pack.id === id)?.key;
  if (!key || !getIsStickerPackValid(id, key)) throw new Error(STICKER_SET_INVALID_ERROR);

  try {
    const manifest = await fetchStickerPackManifest(store, id, key);
    return buildApiStickerSet(id, key, manifest, packs[id]);
  } catch (err) {
    if (err instanceof StickerPackNotFoundError) throw new Error(STICKER_SET_INVALID_ERROR, { cause: err });
    throw err;
  }
}

export async function installStickerSet({ stickerSetId, accessHash }: { stickerSetId: string; accessHash: string }) {
  await processor.setStickerPackInstalled(stickerSetId, accessHash, true).catch(logError);
}

export async function uninstallStickerSet({ stickerSetId, accessHash }: { stickerSetId: string; accessHash: string }) {
  await processor.setStickerPackInstalled(stickerSetId, accessHash, false).catch(logError);
}

/** Stickers sent from this device, newest first; as in Signal Desktop, only those of installed packs */
export async function fetchRecentStickers({ hash }: { hash?: string }) {
  const packs = await store.getItem('stickerPacks') ?? {};
  const stickers: ApiSticker[] = [];
  for (const entry of await store.getItem('recentStickers') ?? []) {
    const [packId, stickerId] = entry.split(':');
    const pack = packs[packId];
    if (pack?.installedAt === undefined) continue;
    const manifest = await store.getStickerPackManifest(packId);
    const sticker = manifest?.stickers.find(({ id }) => id === Number(stickerId));
    if (sticker) stickers.push(buildApiPackSticker(packId, pack.key, sticker.id, sticker.emoji));
  }
  return { hash: hash ?? LIST_HASH, stickers };
}

export async function removeRecentSticker({ sticker }: { sticker: ApiSticker }) {
  const parsed = parsePackStickerId(sticker.id);
  if (!parsed) return undefined;
  const entry = getRecentStickerEntry(parsed.packId, parsed.stickerId);
  const recent = await store.getItem('recentStickers') ?? [];
  await store.setItem('recentStickers', recent.filter((item) => item !== entry));
  return true;
}

export async function clearRecentStickers() {
  await store.setItem('recentStickers', []);
  return true;
}

/** Puts a sent sticker first among the recent ones */
export async function addRecentSticker(packId: string, stickerId: number) {
  const entry = getRecentStickerEntry(packId, stickerId);
  const recent = await store.getItem('recentStickers') ?? [];
  await store.setItem('recentStickers', [entry, ...recent.filter((item) => item !== entry)].slice(
    0, RECENT_STICKERS_LIMIT,
  ));
}

function isStickerSet(set: ApiStickerSet | undefined): set is ApiStickerSet {
  return Boolean(set);
}

function getRecentStickerEntry(packId: string, stickerId: number) {
  return `${packId}:${stickerId}`;
}
