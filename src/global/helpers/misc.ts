import type {
  ApiInputPrivacyRules,
  PrivacyVisibility,
} from '../../api/types';
import type { GlobalState } from '../types';

import { isUserId } from '../../util/entities/ids';
import { partition } from '../../util/iteratees';
import { getAccountsInfo } from '../../util/multiaccount';

export function buildApiInputPrivacyRules(global: GlobalState, {
  visibility,
  isUnspecified,
  allowedIds,
  blockedIds,
}: {
  visibility: PrivacyVisibility;
  isUnspecified?: boolean;
  allowedIds: string[];
  blockedIds: string[];
}): ApiInputPrivacyRules {
  const {
    users: { byId: usersById },
    chats: { byId: chatsById },
  } = global;

  const [allowedUserIds, allowedChatIds] = partition(allowedIds, isUserId);
  const [blockedUserIds, blockedChatIds] = partition(blockedIds, isUserId);

  const rules: ApiInputPrivacyRules = {
    visibility,
    isUnspecified,
    allowedUsers: allowedUserIds.map((userId) => usersById[userId]).filter(Boolean),
    allowedChats: allowedChatIds.map((chatId) => chatsById[chatId]).filter(Boolean),
    blockedUsers: blockedUserIds.map((userId) => usersById[userId]).filter(Boolean),
    blockedChats: blockedChatIds.map((chatId) => chatsById[chatId]).filter(Boolean),
  };

  return rules;
}

export function getCurrentProdAccountCount() {
  return Object.values(getAccountsInfo()).filter((account) => !account.isTest).length;
}
