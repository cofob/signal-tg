import { fetchStickerPackManifest } from '../../../lib/signal/stickers/stickerPacks';
import { buildApiStickerSet } from '../builders/stickers';
import { logError, store } from '../engine';
import { sendApiUpdate } from '../updates';

const MS_PER_SECOND = 1000;

/**
 * Sends installs and removals of sticker packs, here or on another device, as sticker set updates. An installed
 * pack goes with its stickers, downloaded first when it is new to this device.
 */
export async function handleStickerPacksChange(ids: string[]) {
  const packs = await store.getItem('stickerPacks') ?? {};
  for (const id of ids) {
    const pack = packs[id];
    if (!pack) continue;
    if (pack.installedAt === undefined) {
      sendApiUpdate({ '@type': 'updateStickerSet', id, stickerSet: { installedDate: undefined } });
      continue;
    }

    const manifest = await fetchStickerPackManifest(store, id, pack.key).catch(logError);
    sendApiUpdate({
      '@type': 'updateStickerSet',
      id,
      stickerSet: manifest
        ? buildApiStickerSet(id, pack.key, manifest, pack).set
        : {
          id,
          accessHash: pack.key,
          shortName: id,
          title: '',
          count: 0,
          installedDate: Math.floor(pack.installedAt / MS_PER_SECOND),
        },
    });
  }
}
