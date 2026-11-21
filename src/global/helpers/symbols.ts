import type {
  ApiMessage,
  ApiMessageEntityCustomEmoji,
  ApiRichTextCustomEmoji,
  ApiStickerSet,
  ApiStickerSetInfo,
} from '../../api/types';
import { ApiMessageEntityTypes } from '../../api/types';

import { getRichMessageCustomEmojis } from './richMessage';

export function getStickerHashById(stickerId: string, isPreview?: boolean) {
  const base = `document${stickerId}`;
  return !isPreview ? base : `${base}?size=m`;
}

// The server can report an installation date of zero
export function getIsStickerSetInstalled(stickerSet: Pick<ApiStickerSet, 'installedDate'>) {
  return stickerSet.installedDate !== undefined;
}

export function getMessageCustomEmojis(message: ApiMessage): (ApiMessageEntityCustomEmoji | ApiRichTextCustomEmoji)[] {
  const { text, richMessage } = message.content;
  const entityEmojis = text?.entities?.filter((entity): entity is ApiMessageEntityCustomEmoji => (
    entity.type === ApiMessageEntityTypes.CustomEmoji
  )) || [];

  return richMessage ? [...entityEmojis, ...getRichMessageCustomEmojis(richMessage)] : entityEmojis;
}

export function getUniqueStickerSetsInfo(sets: ApiStickerSetInfo[]) {
  return sets.reduce((acc, set) => {
    if ('shortName' in set) {
      if (acc.some((s) => 'shortName' in s && s.shortName === set.shortName)) {
        return acc;
      }
    }

    if ('id' in set) {
      if (acc.some((s) => 'id' in s && s.id === set.id)) {
        return acc;
      }
    }
    acc.push(set); // Optimization
    return acc;
  }, [] as ApiStickerSetInfo[]);
}
