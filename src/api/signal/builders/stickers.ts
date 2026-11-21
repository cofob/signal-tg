import type { StickerPackManifest, StickerPackRecord } from '../../../lib/signal/stickers/stickerPacks';
import type { ApiSticker, ApiStickerSet } from '../../types';

// Signal stickers are 512 × 512 pixels
export const STICKER_SIZE = 512;

// Pack sticker ids are `pack<hex pack id>_<hex pack key>_<sticker id>`: their media hashes differ from those of
// message attachments and carry what the download needs
const PACK_STICKER_ID_REGEX = /^pack([0-9a-f]{32})_([0-9a-f]{64})_(\d+)$/;
const MS_PER_SECOND = 1000;

export type ApiStickerSetWithStickers = {
  set: ApiStickerSet;
  stickers: ApiSticker[];
  packs: Record<string, ApiSticker[]>;
};

/** A sticker pack as the app's sticker set: the hex pack id is its id and short name, the hex pack key its hash */
export function buildApiStickerSet(
  id: string, key: string, manifest: StickerPackManifest, pack?: StickerPackRecord,
): ApiStickerSetWithStickers {
  const stickers = manifest.stickers.map((sticker) => buildApiPackSticker(id, key, sticker.id, sticker.emoji));
  // Emoji come from the manifest: grouping in a `Map` and defining the keys with `Object.fromEntries` keeps a key such
  // as `__proto__` or `constructor` an own property
  const stickersByEmoji = new Map<string, ApiSticker[]>();
  stickers.forEach((sticker) => {
    if (sticker.emoji) stickersByEmoji.set(sticker.emoji, [...stickersByEmoji.get(sticker.emoji) ?? [], sticker]);
  });
  const packs: Record<string, ApiSticker[]> = Object.fromEntries(stickersByEmoji);
  const cover = stickers.find((sticker) => sticker.id === buildPackStickerId(id, key, manifest.coverStickerId))
    ?? buildApiPackSticker(id, key, manifest.coverStickerId);

  return {
    set: {
      id,
      accessHash: key,
      shortName: id,
      title: manifest.title,
      count: stickers.length,
      installedDate: pack?.installedAt !== undefined ? Math.floor(pack.installedAt / MS_PER_SECOND) : undefined,
      covers: [cover],
      stickers,
      packs,
    },
    stickers,
    packs,
  };
}

/** An installed pack whose manifest is not here yet: the app loads its stickers later through `fetchStickers` */
export function buildApiStickerSetStub({ id, key, installedAt }: StickerPackRecord): ApiStickerSet {
  return {
    id,
    accessHash: key,
    shortName: id,
    title: '',
    count: 0,
    installedDate: installedAt !== undefined ? Math.floor(installedAt / MS_PER_SECOND) : undefined,
  };
}

/** A sticker of a pack; its image comes from the sticker CDN */
export function buildApiPackSticker(packId: string, packKey: string, stickerId: number, emoji?: string): ApiSticker {
  return {
    mediaType: 'sticker',
    id: buildPackStickerId(packId, packKey, stickerId),
    stickerSetInfo: { id: packId, accessHash: packKey },
    emoji: emoji || undefined,
    isLottie: false,
    isVideo: false,
    width: STICKER_SIZE,
    height: STICKER_SIZE,
    // Every Signal sticker is free to use
    isFree: true,
  };
}

export function parsePackStickerId(id: string) {
  const match = id.match(PACK_STICKER_ID_REGEX);
  return match ? { packId: match[1], packKey: match[2], stickerId: Number(match[3]) } : undefined;
}

function buildPackStickerId(packId: string, packKey: string, stickerId: number) {
  return `pack${packId}_${packKey}_${stickerId}`;
}
