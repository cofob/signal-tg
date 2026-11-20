import type { ApiSticker, ApiStickerSet, ApiStickerSetInfo } from '../../api/types';
import type { GlobalState } from '../types';

import { RESTRICTED_EMOJI_SET_ID } from '../../config';
import { hasMixedEmojiSkinTones, removeEmojiSkinTone } from '../../util/emoji/skinTone';
import { selectIsCurrentUserPremium } from './users';

const NORMALIZED_ANIMATED_EMOJI_BY_STICKERS = new WeakMap<ApiSticker[], Map<string, ApiSticker>>();

export function selectIsStickerFavorite<T extends GlobalState>(global: T, sticker: ApiSticker) {
  const { stickers } = global.stickers.favorite;
  return stickers && stickers.some(({ id }) => id === sticker.id);
}

export function selectStickerSet<T extends GlobalState>(global: T, id: string | ApiStickerSetInfo) {
  if (typeof id === 'string') {
    return global.stickers.setsById[id];
  }

  if ('id' in id) {
    return global.stickers.setsById[id.id];
  }

  if ('isMissing' in id) return undefined;

  return Object.values(global.stickers.setsById).find(({ shortName }) => (
    shortName.toLowerCase() === id.shortName.toLowerCase()
  ));
}

export function selectStickersForEmoji<T extends GlobalState>(global: T, emoji: string) {
  const addedSets = global.stickers.added.setIds;
  let stickersForEmoji: ApiSticker[] = [];
  // Favorites
  global.stickers.favorite.stickers.forEach((sticker) => {
    if (sticker.emoji === emoji) stickersForEmoji.push(sticker);
  });

  // Added sets
  addedSets?.forEach((id) => {
    const packs = global.stickers.setsById[id].packs;
    if (!packs) {
      return;
    }

    stickersForEmoji = stickersForEmoji.concat(packs[emoji] || [], packs[cleanEmoji(emoji)] || []);
  });
  return stickersForEmoji;
}

export function selectCustomEmojiForEmoji<T extends GlobalState>(global: T, emoji: string) {
  const isCurrentUserPremium = selectIsCurrentUserPremium(global);
  const addedCustomSets = global.customEmojis.added.setIds;
  let customEmojiForEmoji: ApiSticker[] = [];

  // Added sets
  addedCustomSets?.forEach((id) => {
    const packs = global.stickers.setsById[id].packs;
    if (!packs) {
      return;
    }

    customEmojiForEmoji = customEmojiForEmoji.concat(packs[emoji] || [], packs[cleanEmoji(emoji)] || []);
  });
  return isCurrentUserPremium ? customEmojiForEmoji : customEmojiForEmoji.filter(({ isFree }) => isFree);
}

// Slow, not to be used in `withGlobal`
export function selectCustomEmojiForEmojis<T extends GlobalState>(global: T, emojis: string[]) {
  const isCurrentUserPremium = selectIsCurrentUserPremium(global);
  const addedCustomSets = global.customEmojis.added.setIds;
  let customEmojiForEmoji: ApiSticker[] = [];

  // Added sets
  addedCustomSets?.forEach((id) => {
    const packs = global.stickers.setsById[id].packs;
    if (!packs) {
      return;
    }
    const customEmojis = Object.entries(packs).filter(([emoji]) => (
      emojis.includes(emoji) || emojis.includes(cleanEmoji(emoji))
    )).flatMap(([, stickers]) => stickers);
    customEmojiForEmoji = customEmojiForEmoji.concat(customEmojis);
  });
  return isCurrentUserPremium ? customEmojiForEmoji : customEmojiForEmoji.filter(({ isFree }) => isFree);
}

export function selectIsSetPremium(stickerSet: Pick<ApiStickerSet, 'stickers' | 'isEmoji'>) {
  return stickerSet.isEmoji && stickerSet.stickers?.some((sticker) => !sticker.isFree);
}

function cleanEmoji(emoji: string) {
  // Some emojis (❤️ for example) with a service symbol 'VARIATION SELECTOR-16' are not recognized as animated
  return emoji.replace('\ufe0f', '');
}

function normalizeAnimatedEmoji(emoji: string) {
  return cleanEmoji(hasMixedEmojiSkinTones(emoji) ? emoji : removeEmojiSkinTone(emoji));
}

function getAnimatedEmojiByNormalizedEmoji(stickers: ApiSticker[]) {
  const cachedByEmoji = NORMALIZED_ANIMATED_EMOJI_BY_STICKERS.get(stickers);
  if (cachedByEmoji) return cachedByEmoji;

  const byEmoji = new Map<string, ApiSticker>();
  stickers.forEach((sticker) => {
    if (!sticker.emoji) return;

    const normalizedEmoji = normalizeAnimatedEmoji(sticker.emoji);
    if (!byEmoji.has(normalizedEmoji)) {
      byEmoji.set(normalizedEmoji, sticker);
    }
  });
  NORMALIZED_ANIMATED_EMOJI_BY_STICKERS.set(stickers, byEmoji);

  return byEmoji;
}

export function selectAnimatedEmoji<T extends GlobalState>(global: T, emoji: string) {
  const { animatedEmojis } = global;
  if (!animatedEmojis || !animatedEmojis.stickers) {
    return undefined;
  }

  const normalizedEmoji = normalizeAnimatedEmoji(emoji);
  return getAnimatedEmojiByNormalizedEmoji(animatedEmojis.stickers).get(normalizedEmoji);
}

export function selectRestrictedEmoji<T extends GlobalState>(global: T, emoji: string) {
  const { restrictedEmoji } = global;
  if (!restrictedEmoji || !restrictedEmoji.stickers) {
    return undefined;
  }

  const cleanedEmoji = cleanEmoji(emoji);

  return restrictedEmoji.stickers.find((sticker) => {
    if (!sticker.emoji) return undefined;
    const cleanedStickerEmoji = cleanEmoji(sticker.emoji);
    return cleanedStickerEmoji === cleanedEmoji;
  });
}

export function selectAnimatedEmojiEffect<T extends GlobalState>(global: T, emoji: string) {
  const { animatedEmojiEffects } = global;
  if (!animatedEmojiEffects || !animatedEmojiEffects.stickers) {
    return undefined;
  }

  const normalizedEmoji = normalizeAnimatedEmoji(emoji);
  return getAnimatedEmojiByNormalizedEmoji(animatedEmojiEffects.stickers).get(normalizedEmoji);
}

export function selectAnimatedEmojiSound<T extends GlobalState>(global: T, emoji: string) {
  return global?.appConfig.emojiSounds[normalizeAnimatedEmoji(emoji)];
}

export function selectIsAlwaysHighPriorityEmoji<T extends GlobalState>(
  global: T, stickerSet: ApiStickerSetInfo | ApiStickerSet,
) {
  if (!('id' in stickerSet)) return false;
  return stickerSet.id === global.appConfig.defaultEmojiStatusesStickerSetId
    || stickerSet.id === RESTRICTED_EMOJI_SET_ID;
}

export function selectCustomEmoji<T extends GlobalState>(global: T, documentId: string) {
  return global.customEmojis.byId[documentId];
}

export function selectIdleDiceSticker<T extends GlobalState>(global: T, diceEmoji: string) {
  const { diceSetIdByEmoji } = global.stickers;
  if (!diceSetIdByEmoji) return undefined;
  const diceSetId = diceSetIdByEmoji[diceEmoji];
  if (!diceSetId) return undefined;

  const diceSet = global.stickers.setsById[diceSetId];
  if (!diceSet) return undefined;

  return diceSet.stickers?.find((sticker) => sticker.emoji === '#\u20E3');
}

export function selectDiceSticker<T extends GlobalState>(global: T, diceEmoji: string, value: number) {
  const { diceSetIdByEmoji } = global.stickers;
  if (!diceSetIdByEmoji) return undefined;
  const diceSetId = diceSetIdByEmoji[diceEmoji];
  if (!diceSetId) return undefined;

  const diceSet = global.stickers.setsById[diceSetId];
  if (!diceSet) return undefined;

  const numberEmoji = `${value}\u20E3`;
  return diceSet.stickers?.find((sticker) => sticker.emoji === numberEmoji);
}
