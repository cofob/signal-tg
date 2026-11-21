import { store } from '../engine';
import { buildInstalledStickerSet } from '../methods/stickers';
import { sendApiUpdate } from '../updates';

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

    sendApiUpdate({ '@type': 'updateStickerSet', id, stickerSet: await buildInstalledStickerSet(pack) });
  }
}
