import type { GlobalState, TabArgs } from '../types';

import { DEFAULT_GIFT_PROFILE_FILTER_OPTIONS } from '../../config';
import { areRecordsShallowEqual } from '../../util/areShallowEqual';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import {
  getHasAdminRight, isChatAdmin, isChatChannel,
} from '../helpers';
import { selectChat } from './chats';
import { selectTabState } from './tabs';
import { selectUser } from './users';

export type ProfileCollectionKey = number | 'all';

export function selectStarsPayment<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectTabState(global, tabId).starsPayment;
}

export function selectCanUseGiftProfileAdminFilter<T extends GlobalState>(
  global: T, peerId: string,
) {
  const chat = selectChat(global, peerId);
  const isCurrentUser = global.currentUserId === peerId;
  return isCurrentUser || (chat && isChatChannel(chat) && isChatAdmin(chat) && getHasAdminRight(chat, 'postMessages'));
}

export function selectCanUseGiftProfileFilter<T extends GlobalState>(
  global: T, peerId: string,
) {
  const chat = selectChat(global, peerId);
  const user = selectUser(global, peerId);
  return Boolean(user) || (chat && isChatChannel(chat));
}

export function selectGiftProfileFilter<T extends GlobalState>(
  global: T,
  peerId: string,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectCanUseGiftProfileFilter(global, peerId) ? selectTabState(global, tabId).savedGifts.filter : undefined;
}

export function selectIsGiftProfileFilterDefault<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return areRecordsShallowEqual(selectTabState(global, tabId).savedGifts.filter, DEFAULT_GIFT_PROFILE_FILTER_OPTIONS);
}

export function selectActiveGiftsCollectionId<T extends GlobalState>(
  global: T,
  peerId: string,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
): ProfileCollectionKey {
  return selectTabState(global, tabId).savedGifts.activeCollectionByPeerId?.[peerId] || 'all';
}

export function selectStarsGiftResaleCommission<T extends GlobalState>(global: T) {
  const permille = global.appConfig?.starsStargiftResaleCommissionPermille;
  return permille !== undefined ? permille / 1000 : undefined;
}
