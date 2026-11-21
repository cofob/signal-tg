import type {
  ApiChat, ApiChatFullInfo, ApiChatType,
} from '../../api/types';
import type { ChatListType } from '../../types';
import type { GlobalState, TabArgs } from '../types';
import { MAIN_THREAD_ID } from '../../api/types';

import {
  ALL_FOLDER_ID, ARCHIVED_FOLDER_ID,
} from '../../config';
import { isUserId } from '../../util/entities/ids';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import {
  getBlockingRestrictionReasons,
  getHasAdminRight,
  isChatAdmin,
  isUserOnline,
  isUserRightBanned,
} from '../helpers';
import { selectChatMessage, selectOutgoingStatus, selectSender } from './messages';
import { selectPeerStory } from './stories';
import { selectTabState } from './tabs';
import {
  selectUser, selectUserFullInfo,
} from './users';

export function selectChat<T extends GlobalState>(global: T, chatId: string): ApiChat | undefined {
  return global.chats.byId[chatId];
}

export function selectChatFullInfo<T extends GlobalState>(global: T, chatId: string): ApiChatFullInfo | undefined {
  return global.chats.fullInfoById[chatId];
}

export function selectPeerFullInfo<T extends GlobalState>(global: T, peerId: string) {
  if (isUserId(peerId)) return selectUserFullInfo(global, peerId);
  return selectChatFullInfo(global, peerId);
}

export function selectChatHistoryTtl<T extends GlobalState>(global: T, chatId: string) {
  return selectChat(global, chatId)?.ttlPeriod ?? selectPeerFullInfo(global, chatId)?.ttlPeriod;
}

export function selectChatListLoadingParameters<T extends GlobalState>(
  global: T, listType: ChatListType,
) {
  return global.chats.loadingParameters[listType];
}

export function selectIsChatWithSelf<T extends GlobalState>(global: T, chatId: string) {
  return chatId === global.currentUserId;
}

export function selectCanSetVideoCover<T extends GlobalState>(global: T, chatId: string) {
  return selectIsChatWithSelf(global, chatId);
}

export function selectChatOnlineCount<T extends GlobalState>(global: T, chat: ApiChat) {
  const fullInfo = selectChatFullInfo(global, chat.id);
  if (isUserId(chat.id) || !fullInfo) {
    return undefined;
  }

  if (!fullInfo.members) {
    return undefined;
  }

  return fullInfo.members.reduce((onlineCount, { userId }) => {
    if (
      !selectIsChatWithSelf(global, userId)
      && global.users.byId[userId]
      && isUserOnline(global.users.byId[userId], global.users.statusesById[userId])
    ) {
      return onlineCount + 1;
    }

    return onlineCount;
  }, 0);
}

function selectChatType<T extends GlobalState>(global: T, chatId: string): ApiChatType | undefined {
  const user = selectUser(global, chatId);
  if (user) {
    return 'users';
  }

  return selectChat(global, chatId) ? 'chats' : undefined;
}

export function selectAreActiveChatsLoaded<T extends GlobalState>(global: T): boolean {
  return Boolean(global.chats.listIds.active);
}

export function selectIsChatListed<T extends GlobalState>(
  global: T, chatId: string, type?: ChatListType,
): boolean {
  const { listIds } = global.chats;
  if (type) {
    const targetList = listIds[type];
    return Boolean(targetList && targetList.includes(chatId));
  }

  return Object.values(listIds).some((list) => list && list.includes(chatId));
}

export function selectChatListType<T extends GlobalState>(
  global: T, chatId: string,
): 'active' | 'archived' | undefined {
  const chat = selectChat(global, chatId);
  if (!chat || !selectIsChatListed(global, chatId)) {
    return undefined;
  }

  return chat.folderId === ARCHIVED_FOLDER_ID ? 'archived' : 'active';
}

export function selectChatFolder<T extends GlobalState>(global: T, folderId: number) {
  return global.chatFolders.byId[folderId];
}

export function selectIsChatPinned<T extends GlobalState>(
  global: T, chatId: string, folderId = ALL_FOLDER_ID,
): boolean {
  const { active, archived } = global.chats.orderedPinnedIds;

  if (folderId === ALL_FOLDER_ID) {
    return Boolean(active?.includes(chatId));
  }

  if (folderId === ARCHIVED_FOLDER_ID) {
    return Boolean(archived?.includes(chatId));
  }

  const { byId: chatFoldersById } = global.chatFolders;

  const { pinnedChatIds } = chatFoldersById[folderId] || {};
  return Boolean(pinnedChatIds?.includes(chatId));
}

// Slow, not to be used in `withGlobal`
export function selectChatByUsername<T extends GlobalState>(global: T, username: string) {
  const usernameLowered = username.toLowerCase();
  return Object.values(global.chats.byId).find(
    (chat) => chat.usernames?.some((c) => c.username.toLowerCase() === usernameLowered),
  );
}

export function selectRequestedDraft<T extends GlobalState>(
  global: T, chatId: string,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { requestedDraft } = selectTabState(global, tabId);
  if (requestedDraft?.chatId === chatId && !requestedDraft.files?.length) {
    return requestedDraft.text;
  }
  return undefined;
}

export function selectRequestedDraftFiles<T extends GlobalState>(
  global: T, chatId: string,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { requestedDraft } = selectTabState(global, tabId);
  if (requestedDraft?.chatId === chatId) {
    return requestedDraft.files;
  }
  return undefined;
}

export function filterChatIdsByType<T extends GlobalState>(
  global: T, chatIds: string[], filter: readonly ApiChatType[],
) {
  return chatIds.filter((id) => {
    const type = selectChatType(global, id);
    if (!type) {
      return false;
    }
    return filter.includes(type);
  });
}

export function selectCanInviteToChat<T extends GlobalState>(global: T, chatId: string) {
  const chat = selectChat(global, chatId);
  if (!chat) return false;

  return !isUserId(chatId) && getHasAdminRight(chat, 'inviteUsers');
}

export function selectCanBanUsers<T extends GlobalState>(global: T, chatId: string) {
  const chat = selectChat(global, chatId);
  if (!chat) return false;

  return getHasAdminRight(chat, 'banUsers');
}

export function selectChatLastMessageId<T extends GlobalState>(global: T, chatId: string) {
  return global.chats.lastMessageIds.all?.[chatId];
}

export function selectChatLastMessage<T extends GlobalState>(global: T, chatId: string) {
  const id = selectChatLastMessageId(global, chatId);
  if (!id) return undefined;

  return global.messages.byChatId[chatId]?.byId[id];
}

export function selectChatLastMessageInfo<T extends GlobalState>(global: T, {
  chatId, previewMessageId,
}: {
  chatId: string;
  previewMessageId?: number;
}) {
  const lastMessageId = previewMessageId || selectChatLastMessageId(global, chatId);
  const lastMessage = previewMessageId
    ? selectChatMessage(global, chatId, previewMessageId)
    : selectChatLastMessage(global, chatId);
  const { isOutgoing } = lastMessage || {};
  const messageSender = lastMessage ? selectSender(global, lastMessage) : undefined;
  const storyData = lastMessage?.content.storyData;

  return {
    lastMessage,
    lastMessageId,
    lastMessageSender: messageSender,
    lastMessageOutgoingStatus: isOutgoing && lastMessage
      ? selectOutgoingStatus(global, chatId, MAIN_THREAD_ID, lastMessage.id, 'thread')
      : undefined,
    lastMessageStory: storyData && selectPeerStory(global, storyData.peerId, storyData.id),
  };
}

export function selectIsChatRestricted<T extends GlobalState>(global: T, chatId: string): boolean {
  const chat = selectChat(global, chatId);
  if (!chat) return false;

  const activeRestrictions = getBlockingRestrictionReasons(
    chat.restrictionReasons, global.appConfig.ignoreRestrictionReasons,
  );
  return activeRestrictions.length > 0;
}

export function selectAreFoldersPresent<T extends GlobalState>(global: T) {
  const ids = global.chatFolders.orderedIds;
  return Boolean(ids && ids.length > 1);
}

export function selectCanEditRank<T extends GlobalState>(global: T, {
  chatId, userId,
}: {
  chatId: string;
  userId: string;
}) {
  const chat = selectChat(global, chatId);
  if (!chat || chat.isNotJoined || chat.isRestricted) return false;

  // Members set only their own label; admins can do that even when only admins may
  if (userId !== global.currentUserId) return false;
  return selectCanEditOwnRank(global, chatId);
}

export function selectCanEditOwnRank<T extends GlobalState>(global: T, chatId: string) {
  const chat = selectChat(global, chatId);
  if (!chat || chat.isNotJoined || chat.isRestricted) return false;

  return isChatAdmin(chat) || !isUserRightBanned(chat, 'editRank');
}

export function selectIsChatUnread<T extends GlobalState>(global: T, chatId: string) {
  const readState = global.messages.byChatId[chatId]?.threadsById?.[MAIN_THREAD_ID]?.readState;

  return Boolean(readState?.unreadCount || readState?.hasUnreadMark);
}
