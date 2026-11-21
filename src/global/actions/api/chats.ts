import type {
  ApiChat, ApiChatFullInfo,
  ApiChatMember, ApiDraft, ApiError,
  LinkContext,
} from '../../../api/types';
import type { RequiredGlobalActions } from '../../index';
import type {
  ActionReturnType, GlobalState, TabArgs,
} from '../../types';
import { MAIN_THREAD_ID } from '../../../api/types';
import {
  ChatCreationProgress,
  type ChatListType,
  ManagementProgress,
  NewChatMembersProgress,
  type ThreadId,
} from '../../../types';

import {
  ALL_FOLDER_ID,
  ARCHIVED_FOLDER_ID,
  CHAT_LIST_LOAD_SLICE,
  DEBUG,
  TMP_CHAT_ID,
  TOP_CHAT_MESSAGES_PRELOAD_LIMIT,
} from '../../../config';
import { processDeepLink } from '../../../util/deeplink';
import { isUserId } from '../../../util/entities/ids';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { getOrderedIds, getPinnedChatsCount } from '../../../util/folderManager';
import {
  buildCollectionByKey, omit,
} from '../../../util/iteratees';
import { isLocalMessageId } from '../../../util/keys/messageKey';
import { notifyAboutMessage } from '../../../util/notifications';
import { debounce, pause, throttle } from '../../../util/schedulers';
import { callApi } from '../../../api';
import { LIMITS, MAX_FOLDERS } from '../../../limits';
import {
  isChatArchived,
} from '../../helpers';
import {
  addActionHandler, getActions, getGlobal, setGlobal,
} from '../../index';
import {
  addChatListIds,
  addChatMembers,
  addChats,
  addMessages,
  addNotifyExceptions,
  addUsers,
  addUserStatuses,
  batchMessageStoreUpdates,
  deleteChatMessages,
  deletePeerPhoto,
  leaveChat,
  replaceChatFullInfo,
  replaceChatListIds,
  replaceChatListLoadingParameters,
  replaceMessages,
  replaceNotifyExceptions,
  replaceUserStatuses,
  updateChat,
  updateChatFullInfo,
  updateChatListSecondaryInfo,
  updateChatParticipantRank,
  updateChats,
  updateChatsLastMessageId,
  updateManagementProgress,
  updateMissingInvitedUsers,
  updateUser,
  updateUsers,
} from '../../reducers';
import { updateTabState } from '../../reducers/tabs';
import {
  replaceThreadLocalStateParam,
  updateMainThreadReadStates,
  updateThreadInfo,
  updateThreadReadState,
} from '../../reducers/threads';
import {
  selectCanOpenMessageList,
  selectChat,
  selectChatByUsername,
  selectChatFolder,
  selectChatFullInfo,
  selectChatLastMessageId,
  selectChatListLoadingParameters,
  selectChatListType,
  selectChatMessages,
  selectCurrentChat,
  selectCurrentMessageList,
  selectIsChatPinned,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectPeer,
  selectTabState,
  selectUser,
  selectUserByPhoneNumber,
} from '../../selectors';
import {
  selectDraft,
  selectThread,
  selectThreadInfo,
  selectThreadReadState,
} from '../../selectors/threads';

const TOP_CHAT_MESSAGES_PRELOAD_INTERVAL = 100;
const INFINITE_LOOP_MARKER = 100;

const runThrottledForLoadTopChats = throttle((cb) => cb(), 3000, true);
const runDebouncedForLoadFullChat = debounce((cb) => cb(), 500, false, true);

addActionHandler('preloadTopChatMessages', async (global, actions): Promise<void> => {
  const preloadedChatIds = new Set<string>();

  for (let i = 0; i < TOP_CHAT_MESSAGES_PRELOAD_LIMIT; i++) {
    await pause(TOP_CHAT_MESSAGES_PRELOAD_INTERVAL);

    global = getGlobal();
    const currentChatIds = Object.values(global.byTabId)

      .map(({ id: tabId }) => selectCurrentMessageList(global, tabId)?.chatId)
      .filter(Boolean);

    const folderAllOrderedIds = getOrderedIds(ALL_FOLDER_ID);
    const nextChatId = folderAllOrderedIds?.find((id) => {
      return !currentChatIds.includes(id) && !preloadedChatIds.has(id);
    });
    if (!nextChatId) {
      return;
    }

    preloadedChatIds.add(nextChatId);

    actions.loadViewportMessages({ chatId: nextChatId, threadId: MAIN_THREAD_ID, tabId: getCurrentTabId() });
  }
});

addActionHandler('openChat', (global, actions, payload): ActionReturnType => {
  const {
    id, type, shouldReplaceHistory, shouldReplaceLast,
    tabId = getCurrentTabId(),
  } = payload;

  if (!selectCanOpenMessageList(global, id, MAIN_THREAD_ID, type, tabId)) return;

  actions.processOpenChatOrThread({
    chatId: id,
    type,
    threadId: MAIN_THREAD_ID,
    shouldReplaceHistory,
    shouldReplaceLast,
    tabId,
  });

  if (!id || id === TMP_CHAT_ID) {
    return;
  }

  const chat = selectChat(global, id);
  const threadInfo = selectThreadInfo(global, id, MAIN_THREAD_ID);
  const chatReadState = selectThreadReadState(global, id, MAIN_THREAD_ID);

  if (chatReadState?.hasUnreadMark) {
    actions.markChatRead({ id });
  }

  const isChatOnlySummary = !threadInfo || !selectChatLastMessageId(global, id);

  if (!chat) {
    if (selectIsChatWithSelf(global, id)) {
      void callApi('fetchChat', { type: 'self', shouldRequestUpdate: true });
    } else {
      const user = selectUser(global, id);
      if (user) {
        void callApi('fetchChat', { type: 'user', user, shouldRequestUpdate: true });
      }
    }
  } else if (isChatOnlySummary && !chat.isMin) {
    actions.requestChatUpdate({ chatId: id });
  }
});

// Refetch topic if thread info is missing
addActionHandler('loadAllChats', async (global, actions, payload): Promise<void> => {
  const { whenFirstBatchDone } = payload;
  const listType = payload.listType;
  let isCallbackFired = false;
  let i = 0;

  while (!global.chats.isFullyLoaded[listType]) {
    if (i++ >= INFINITE_LOOP_MARKER) {
      if (DEBUG) {
        // eslint-disable-next-line no-console
        console.error('`actions/loadAllChats`: Infinite loop detected');
      }

      return;
    }

    global = getGlobal();

    if (global.connectionState !== 'connectionStateReady' || global.auth.state !== 'authorizationStateReady') {
      return;
    }

    const result = await loadChats(
      listType,
      true,
    );

    const isFirstBatch = !isCallbackFired;
    if (!isCallbackFired) {
      await whenFirstBatchDone?.();
      isCallbackFired = true;
    }
    global = getGlobal();

    if (result?.messages) {
      const { messages } = result;
      global = batchMessageStoreUpdates(global, (g) => (
        isFirstBatch ? replaceMessages(g, messages) : addMessages(g, messages)
      ));
    }

    setGlobal(global);
    global = getGlobal();
  }

  // A list loaded before a reconnect is complete already, and `sync` still waits for its first batch
  if (!isCallbackFired) await whenFirstBatchDone?.();
});

addActionHandler('loadFullChat', (global, actions, payload): ActionReturnType => {
  const {
    chatId, force, withPhotos,
  } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const loadChat = async () => {
    await loadFullChat(global, actions, chat);
    if (withPhotos) {
      actions.loadMoreProfilePhotos({ peerId: chatId, shouldInvalidateCache: true });
    }
  };

  if (force) {
    void loadChat();
  } else {
    runDebouncedForLoadFullChat(loadChat);
  }
});

addActionHandler('invalidateFullInfo', (global, actions, payload): ActionReturnType => {
  const { peerId } = payload;

  const isUser = isUserId(peerId);

  if (isUser) {
    return {
      ...global,
      users: {
        ...global.users,
        fullInfoById: omit(global.users.fullInfoById, [peerId]),
      },
    };
  }

  return {
    ...global,
    chats: {
      ...global.chats,
      fullInfoById: omit(global.chats.fullInfoById, [peerId]),
    },
  };
});

addActionHandler('loadTopChats', (global, actions, payload): ActionReturnType => {
  const message = payload?.messageToNotify;

  // shortcut: throttling keeps only the latest pending call, upgrade if bursts need separate notifications
  runThrottledForLoadTopChats(async () => {
    await Promise.all([
      loadChats('active', undefined, true),
      loadChats('archived', undefined, true),
    ]);

    if (!message) return;

    global = getGlobal();
    const chat = selectChat(global, message.chatId);
    if (chat) {
      void notifyAboutMessage({ chat, message });
    }
  });
});

addActionHandler('requestChatUpdate', (global, actions, payload): ActionReturnType => {
  const { chatId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  void callApi('requestChatUpdate', { chat });
});

addActionHandler('updateChatMutedState', (global, actions, payload): ActionReturnType => {
  const { chatId, mutedUntil } = payload;

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId: getCurrentTabId() });
    return;
  }

  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  void callApi('updateChatNotifySettings', { chat, settings: { mutedUntil } });
});

addActionHandler('joinChannel', async (global, actions, payload): Promise<void> => {
  const { chatId, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  // Signal groups have no access hash; joining one accepts our invitation
  const { id: channelId, accessHash = '' } = chat;

  try {
    await callApi('joinChannel', { channelId, accessHash });

    if (chat.isJoinRequest) {
      actions.showNotification({
        message: {
          key: 'RequestToJoinGroupSentDescription',
        },
        tabId,
      });
    }
  } catch (error) {
    actions.showDialog({ data: { type: 'error', ...(error as ApiError), hasErrorKey: true }, tabId });
  }
});

// Signal groups cannot be deleted for everyone; deleting one leaves it, which the last admin cannot do
addActionHandler('deleteChat', async (global, actions, payload): Promise<void> => {
  const { chatId, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const isLeft = await callApi('deleteChat', { chatId: chat.id });
  if (!isLeft) return;

  global = getGlobal();
  global = leaveChat(global, chatId);
  setGlobal(global);

  if (selectCurrentMessageList(global, tabId)?.chatId === chatId) {
    actions.openChat({ id: undefined, tabId });
  }
});

// Signal admins end a group for everyone; it stays in the list with its history
addActionHandler('terminateChat', async (global, actions, payload): Promise<void> => {
  const { chatId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  await callApi('terminateChat', { chat });
});

// Taking back an invitation changes the group, which brings the new list of invitations
addActionHandler('revokeChatInvite', async (global, actions, payload): Promise<void> => {
  const { chatId, serviceId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  await callApi('revokeChatInvite', { chat, serviceId });
});

// Signal: a number that belongs to a Signal user, even one we know by PNI only, is added or invited
addActionHandler('addChatMemberByPhoneNumber', async (global, actions, payload): Promise<void> => {
  const { chatId, phoneNumber, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  actions.setNewChatMembersDialogState({ newChatMembersProgress: NewChatMembersProgress.Loading, tabId });
  const result = await callApi('addChatMemberByPhoneNumber', { chat, phoneNumber });
  actions.setNewChatMembersDialogState({ newChatMembersProgress: NewChatMembersProgress.Closed, tabId });
  if (!result) return;

  const phone = `+${phoneNumber}`;
  if ('error' in result) {
    actions.showNotification({
      message: result.error === 'notFound' ? {
        key: 'UsernameByPhoneNotFound',
        variables: { phone: phoneNumber },
        options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
      } : { key: result.error === 'rateLimited' ? 'ErrorPhoneLookupRateLimited' : 'ErrorPhoneLookupUnavailable' },
      tabId,
    });
    return;
  }

  actions.showNotification({
    message: { key: result.status === 'invited' ? 'GroupPhoneInvited' : 'GroupPhoneAdded', variables: { phone } },
    tabId,
  });
  global = getGlobal();
  loadFullChat(global, actions, chat);
});

function cleanupAfterLeave(chatId: string, tabId: number) {
  let global = getGlobal();
  global = leaveChat(global, chatId);
  setGlobal(global);

  if (selectCurrentMessageList(global, tabId)?.chatId === chatId) {
    getActions().openChat({ id: undefined, tabId });
  }

  global = getGlobal();
  const chatMessages = selectChatMessages(global, chatId);
  if (!chatMessages) {
    return;
  }

  const localMessageIds = Object.keys(chatMessages).map(Number).filter(isLocalMessageId);
  if (!localMessageIds.length) {
    return;
  }

  global = deleteChatMessages(global, chatId, localMessageIds);
  setGlobal(global);
}

addActionHandler('leaveBasicGroup', async (global, actions, payload): Promise<void> => {
  const { chatId, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  const currentUserId = global.currentUserId;
  if (!chat || !currentUserId) {
    return;
  }

  // The history stays until leaving succeeds: the last admin of a Signal group cannot leave
  global = getGlobal();
  const user = selectUser(global, currentUserId);
  const isLeft = user && await callApi('deleteChatUser', { chat, user, shouldRevokeHistory: false });
  if (!isLeft) return;

  actions.deleteHistory({ chatId, shouldDeleteForAll: false, tabId });
  cleanupAfterLeave(chatId, tabId);
});

addActionHandler('createGroupChat', async (global, actions, payload): Promise<void> => {
  const {
    title, memberIds, photo, tabId = getCurrentTabId(),
  } = payload;
  const users = (memberIds)
    .map((id) => selectUser(global, id))
    .filter(Boolean);

  global = updateTabState(global, {
    chatCreation: {
      progress: ChatCreationProgress.InProgress,
    },
  }, tabId);
  setGlobal(global);

  try {
    const { chat: createdChat, missingUsers } = await callApi('createGroupChat', {
      title,
      users,
    }) ?? {};

    if (!createdChat) {
      return;
    }

    const { id: chatId } = createdChat;

    global = getGlobal();
    global = updateChat(global, chatId, createdChat);
    global = updateTabState(global, {
      chatCreation: {
        ...selectTabState(global, tabId).chatCreation,
        progress: createdChat ? ChatCreationProgress.Complete : ChatCreationProgress.Error,
      },
    }, tabId);
    setGlobal(global);
    actions.openChat({
      id: chatId,
      shouldReplaceHistory: true,
      tabId,
    });

    if (missingUsers) {
      global = getGlobal();
      global = updateMissingInvitedUsers(global, chatId, missingUsers, tabId);
      setGlobal(global);
    }

    if (photo) {
      await callApi('editChatPhoto', { chat: createdChat, photo });
    }
  } catch (err) {
    if ((err as ApiError).message === 'USERS_TOO_FEW') {
      global = getGlobal();
      global = updateTabState(global, {
        chatCreation: {
          ...selectTabState(global, tabId).chatCreation,
          progress: ChatCreationProgress.Error,
          error: 'CreateGroupError',
        },
      }, tabId);
      setGlobal(global);
    }
  }
});

addActionHandler('toggleChatPinned', (global, actions, payload): ActionReturnType => {
  const { id, folderId, tabId = getCurrentTabId() } = payload;

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId });
    return;
  }
  const chat = selectChat(global, id);
  if (!chat) {
    return;
  }

  const limit = LIMITS.dialogFolderPinned;

  if (folderId) {
    const folder = selectChatFolder(global, folderId);
    if (folder) {
      const shouldBePinned = !selectIsChatPinned(global, id, folderId);

      const { pinnedChatIds, includedChatIds } = folder;
      const newPinnedIds = shouldBePinned
        ? [id, ...(pinnedChatIds || [])]
        : (pinnedChatIds || []).filter((pinnedId) => pinnedId !== id);

      // With both Pin and Unpin we need to re-add a user to the included group
      const newIncludedChatIds = [id, ...includedChatIds];

      void callApi('editChatFolder', {
        id: folderId,
        folderUpdate: {
          ...folder,
          pinnedChatIds: newPinnedIds,
          includedChatIds: newIncludedChatIds,
        },
      });
    }
  } else {
    const listType = selectChatListType(global, id);
    const isPinned = selectIsChatPinned(global, id, listType === 'archived' ? ARCHIVED_FOLDER_ID : undefined);

    const resolvedFolderId = listType === 'archived' ? ARCHIVED_FOLDER_ID : ALL_FOLDER_ID;
    if (getPinnedChatsCount(resolvedFolderId) >= limit && !isPinned) {
      actions.openLimitReachedModal({
        limit: 'dialogFolderPinned',
        tabId,
      });
      return;
    }
    void callApi('toggleChatPinned', { chat, shouldBePinned: !isPinned });
  }
});

addActionHandler('toggleChatArchived', (global, actions, payload): ActionReturnType => {
  const { id } = payload;

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId: getCurrentTabId() });
    return;
  }

  const chat = selectChat(global, id);
  if (chat) {
    void callApi('toggleChatArchived', {
      chat,
      folderId: isChatArchived(chat) ? 0 : ARCHIVED_FOLDER_ID,
    });
  }
});

addActionHandler('loadChatFolders', async (global): Promise<void> => {
  const chatFolders = await callApi('fetchChatFolders');

  if (chatFolders) {
    global = getGlobal();

    global = {
      ...global,
      chatFolders: {
        ...global.chatFolders,
        ...chatFolders,
      },
    };
    setGlobal(global);
  }
});

addActionHandler('editChatFolders', (global, actions, payload): ActionReturnType => {
  const {
    chatId, idsToRemove, idsToAdd, tabId = getCurrentTabId(),
  } = payload;
  const limit = LIMITS.dialogFiltersChats;

  const isLimitReached = idsToAdd
    .some((id) => selectChatFolder(global, id).includedChatIds.length >= limit);
  if (isLimitReached) {
    actions.openLimitReachedModal({ limit: 'dialogFiltersChats', tabId });
    return;
  }

  idsToRemove.forEach((id) => {
    const folder = selectChatFolder(global, id);
    if (folder) {
      callApi('editChatFolder', {
        id,
        folderUpdate: {
          ...folder,
          pinnedChatIds: folder.pinnedChatIds?.filter((pinnedId) => pinnedId !== chatId),
          includedChatIds: folder.includedChatIds.filter((includedId) => includedId !== chatId),
        },
      });
    }
  });

  idsToAdd.forEach((id) => {
    const folder = selectChatFolder(global, id);
    if (folder) {
      callApi('editChatFolder', {
        id,
        folderUpdate: {
          ...folder,
          includedChatIds: folder.includedChatIds.concat(chatId),
        },
      });
    }
  });
});

addActionHandler('editChatFolder', (global, actions, payload): ActionReturnType => {
  const { id, folderUpdate } = payload;
  const folder = selectChatFolder(global, id);

  if (folder) {
    void callApi('editChatFolder', {
      id,
      folderUpdate: {
        id,
        emoticon: folder.emoticon,
        pinnedChatIds: folder.pinnedChatIds,
        ...folderUpdate,
      },
    });
  }
});

addActionHandler('addChatFolder', async (global, actions, payload): Promise<void> => {
  const { folder, tabId = getCurrentTabId() } = payload;
  const { orderedIds, byId } = global.chatFolders;

  if (Object.keys(byId).length >= MAX_FOLDERS) {
    actions.openLimitReachedModal({
      limit: 'dialogFilters',
      tabId,
    });
    return;
  }

  const maxId = Math.max(...(orderedIds || []), ARCHIVED_FOLDER_ID);

  const newId = maxId + 1;
  const folderUpdate = {
    ...folder,
    id: newId,
  };
  await callApi('editChatFolder', {
    id: newId,
    folderUpdate,
  });

  // Update called from the above `callApi` is throttled, but we need to apply changes immediately
  actions.apiUpdate({
    '@type': 'updateChatFolder',
    id: newId,
    folder: folderUpdate,
  });

  actions.requestNextFoldersAction({
    foldersAction: {
      type: 'setFolderId',
      payload: maxId + 1,
    },
    tabId,
  });
});

addActionHandler('sortChatFolders', async (global, actions, payload): Promise<void> => {
  const { folderIds } = payload;

  const result = await callApi('sortChatFolders', folderIds);
  if (result) {
    global = getGlobal();
    global = {
      ...global,
      chatFolders: {
        ...global.chatFolders,
        orderedIds: folderIds,
      },
    };
    setGlobal(global);
  }
});

addActionHandler('deleteChatFolder', async (global, actions, payload): Promise<void> => {
  const { id } = payload;
  const folder = selectChatFolder(global, id);

  if (folder) {
    await callApi('deleteChatFolder', id);
  }
});

addActionHandler('markChatUnread', (global, actions, payload): ActionReturnType => {
  const { id } = payload;

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId: getCurrentTabId() });
    return;
  }

  const chat = selectChat(global, id);
  if (!chat) return;
  void callApi('toggleDialogUnread', {
    chat,
    hasUnreadMark: true,
  });
});

addActionHandler('markChatMessagesRead', async (global, actions, payload): Promise<void> => {
  if (selectIsCurrentUserFrozen(global)) return;
  const { id } = payload;

  if (selectIsCurrentUserFrozen(global)) {
    actions.openFrozenAccountModal({ tabId: getCurrentTabId() });
    return;
  }

  const chat = selectChat(global, id);
  const chatReadState = selectThreadReadState(global, id, MAIN_THREAD_ID);
  if (!chat) return;

  await callApi('markMessageListRead', { chat, threadId: MAIN_THREAD_ID });
  actions.readAllMentions({ chatId: id });
  if (chatReadState?.hasUnreadMark) {
    actions.markChatRead({ id });
  }
});

addActionHandler('markChatRead', (global, actions, payload): ActionReturnType => {
  const { id } = payload;
  const chat = selectChat(global, id);
  if (!chat) return;

  callApi('toggleDialogUnread', {
    chat,
    hasUnreadMark: undefined,
  });
});

addActionHandler('checkChatInvite', async (global, actions, payload): Promise<void> => {
  const { hash, tabId = getCurrentTabId() } = payload;

  const result = await callApi('checkChatInvite', hash);
  if (!result) {
    return;
  }

  global = getGlobal();

  if (result.users) {
    global = addUsers(global, buildCollectionByKey(result.users, 'id'));
  }

  if (result.chat) {
    global = addChats(global, buildCollectionByKey([result.chat], 'id'));
    setGlobal(global);
    actions.openChat({ id: result.chat.id, tabId });
    return;
  }

  global = updateTabState(global, {
    chatInviteModal: {
      hash,
      inviteInfo: result.invite,
    },
  }, tabId);
  setGlobal(global);
});

addActionHandler('openChatByPhoneNumber', async (global, actions, payload): Promise<void> => {
  const {
    phoneNumber, text, tabId = getCurrentTabId(),
  } = payload;

  // Open temporary empty chat to make the click response feel faster
  actions.openChat({ id: TMP_CHAT_ID, tabId });

  const chat = await fetchChatByPhoneNumber(global, phoneNumber);
  if (!chat || 'error' in chat) {
    actions.openPreviousChat({ tabId });
    const error = chat?.error ?? 'notFound';
    actions.showNotification({
      message: error === 'notFound' ? {
        key: 'UsernameByPhoneNotFound',
        variables: {
          phone: phoneNumber,
        },
        options: { withNodes: true, withMarkdown: true, renderTextFilters: ['br', 'links'] },
      } : { key: error === 'rateLimited' ? 'ErrorPhoneLookupRateLimited' : 'ErrorPhoneLookupUnavailable' },
      tabId,
    });
    return;
  }

  if (text) {
    actions.openChatWithDraft({ chatId: chat.id, text: { text }, tabId });
  } else {
    actions.openChat({ id: chat.id, tabId });
  }
});

addActionHandler('openChatByContactToken', async (global, actions, payload): Promise<void> => {
  const { token, tabId = getCurrentTabId() } = payload;

  actions.openChat({ id: TMP_CHAT_ID, tabId });

  const result = await callApi('importContactToken', { token });
  if (!result || 'messageKey' in result) {
    actions.openPreviousChat({ tabId });
    actions.showNotification({ message: result?.messageKey ?? { key: 'ContactLinkInvalid' }, tabId });
    return;
  }

  global = getGlobal();
  global = updateUser(global, result.id, result);
  setGlobal(global);

  actions.openChat({ id: result.id, tabId });
});

// Opens the app's own links, `tg:` and Signal's; any other link, such as a Telegram website's, is not followed
addActionHandler('openTelegramLink', (global, actions, payload): ActionReturnType => {
  const { url, linkContext } = payload;

  processDeepLink(url, linkContext);
});

/** Opens the chat behind a `signal.me/#eu/` username link or its QR code */
addActionHandler('openChatByUsernameLink', async (global, actions, payload): Promise<void> => {
  const { url, tabId = getCurrentTabId() } = payload;

  const username = await callApi('resolveUsernameLink', url);
  if (!username) {
    actions.showNotification({ message: { key: 'SignalUsernameLinkInvalid' }, tabId });
    return;
  }
  actions.openChatByUsername({ username, tabId });
});

/** Opens the chat with a Signal user by ACI, such as a shared contact that has no chat yet */
addActionHandler('openChatByAci', async (global, actions, payload): Promise<void> => {
  const { aci, tabId = getCurrentTabId() } = payload;
  const result = await callApi('getChatByAci', aci);
  if (!result) return;

  global = getGlobal();
  global = updateChat(global, result.chat.id, result.chat);
  global = updateUser(global, result.user.id, result.user);
  setGlobal(global);
  actions.openChat({ id: result.chat.id, tabId });
});

addActionHandler('acceptChatInvite', async (global, actions, payload): Promise<void> => {
  const {
    hash, isBroadcast, tabId = getCurrentTabId(),
  } = payload;
  const result = await callApi('importChatInvite', { hash });

  if (result?.type === 'ok' && result.chat) {
    actions.openChat({ id: result.chat.id, tabId });
    return;
  }

  if (result?.type === 'requested') {
    actions.showNotification({
      message: { key: isBroadcast ? 'RequestToJoinChannelSentDescription' : 'RequestToJoinGroupSentDescription' },
      tabId,
    });
  }
});

addActionHandler('openChatByUsername', async (global, actions, payload): Promise<void> => {
  const {
    username, messageId, threadId,
    text, onChatChanged, timestamp, linkContext,
    tabId = getCurrentTabId(),
  } = payload;

  const chat = selectCurrentChat(global, tabId);

  if (messageId && chat?.usernames?.some((c) => c.username === username)) {
    actions.focusMessage({
      chatId: chat.id, threadId, messageId, timestamp, tabId,
    });
    return;
  }

  await openChatByUsername(
    global, actions, {
      username,
      threadId,
      channelPostId: messageId,
      text,
      timestamp,
      linkContext,
    }, tabId,
  );
  if (onChatChanged) {
    // @ts-ignore
    actions[onChatChanged.action](onChatChanged.payload);
  }
});

addActionHandler('updateChatDefaultBannedRights', (global, actions, payload): ActionReturnType => {
  const { chatId, bannedRights } = payload;
  const chat = selectChat(global, chatId);

  if (!chat) {
    return;
  }

  void callApi('updateChatDefaultBannedRights', { chat, bannedRights });
});

addActionHandler('updateChatMemberBannedRights', async (global, actions, payload): Promise<void> => {
  const {
    chatId, peerId, bannedRights,
    tabId = getCurrentTabId(),
  } = payload;

  const peer = selectPeer(global, peerId);

  if (!peer) {
    return;
  }

  const chat = await ensureIsSuperGroup(global, actions, chatId, tabId);

  if (!chat) return;

  const result = await callApi('updateChatMemberBannedRights', { chat, peer, bannedRights });

  if (!result) {
    return;
  }

  global = getGlobal();

  const updatedFullInfo = selectChatFullInfo(global, chat.id);
  if (!updatedFullInfo) {
    return;
  }

  const { members, kickedMembers } = updatedFullInfo;

  const isBanned = Boolean(bannedRights.viewMessages);
  const isUnblocked = !Object.keys(bannedRights).length;

  const fullInfoUpdate: Partial<ApiChatFullInfo> = {};
  if (members) {
    fullInfoUpdate.members = isBanned
      ? members.filter((m) => m.userId !== peerId)
      : members.map((m) => (m.userId === peerId ? { ...m, bannedRights } : m));
  }
  if (isBanned) {
    const bannedMember: ApiChatMember = {
      userId: peerId,
      bannedRights,
      kickedByUserId: global.currentUserId,
    };
    fullInfoUpdate.kickedMembers = [
      ...(kickedMembers?.filter((m) => m.userId !== peerId) || []),
      bannedMember,
    ];
  } else if (isUnblocked && kickedMembers) {
    fullInfoUpdate.kickedMembers = kickedMembers.filter((m) => m.userId !== peerId);
  }

  global = updateChatFullInfo(global, chat.id, fullInfoUpdate);
  if (isBanned && isUserId(peerId)) {
    global = updateChat(global, chat.id, { membersCount: Math.max(0, (chat.membersCount || 0) - 1) });
  }

  setGlobal(global);
});

addActionHandler('updateChatAdmin', async (global, actions, payload): Promise<void> => {
  if (selectIsCurrentUserFrozen(global)) return;

  const {
    chatId, userId, adminRights, rank,
    tabId = getCurrentTabId(),
  } = payload;

  const user = selectUser(global, userId);
  if (!user) {
    return;
  }

  const chat = await ensureIsSuperGroup(global, actions, chatId, tabId);

  if (!chat) return;

  await callApi('updateChatAdmin', {
    chat, user, adminRights, rank,
  });

  const chatAfterUpdate = await callApi('fetchFullChat', chat);

  global = getGlobal();

  if (chatAfterUpdate?.membersCount !== undefined) {
    global = updateChat(global, chat.id, { membersCount: chatAfterUpdate.membersCount });
  }
  const isDismissed = !Object.keys(adminRights).length;
  const adminMembersById = chatAfterUpdate?.fullInfo?.adminMembersById;
  if (adminMembersById) {
    const currentMembers = selectChatFullInfo(global, chat.id)?.members;
    const isNewMember = currentMembers && !currentMembers.some((member) => member.userId === userId);
    if (!isDismissed && isNewMember) {
      global = addChatMembers(global, chat, [{
        userId,
        adminRights,
        rank,
        isAdmin: true,
        promotedByUserId: global.currentUserId,
      }]);
    }

    let newAdminMembersById: Record<string, ApiChatMember>;
    if (isDismissed) {
      const { [userId]: remove, ...rest } = adminMembersById;
      newAdminMembersById = rest;
    } else {
      newAdminMembersById = {
        ...adminMembersById,
        [userId]: {
          ...adminMembersById[userId],
          adminRights,
          rank,
        },
      };
    }

    global = updateChatFullInfo(global, chat.id, { adminMembersById: newAdminMembersById });
  }

  setGlobal(global);
});

addActionHandler('editChatParticipantRank', async (global, actions, payload): Promise<void> => {
  if (selectIsCurrentUserFrozen(global)) {
    return;
  }

  const {
    chatId, userId, rank,
  } = payload;

  const chat = selectChat(global, chatId);
  const peer = selectPeer(global, userId);
  if (!chat || !peer) {
    return;
  }

  const isUpdated = await callApi('editChatParticipantRank', { chat, peer, rank });
  if (!isUpdated) {
    return;
  }

  global = getGlobal();
  global = updateChatParticipantRank(global, chat.id, userId, rank);
  setGlobal(global);
});

addActionHandler('updateChat', async (global, actions, payload): Promise<void> => {
  const {
    chatId, title, about, photo, tabId = getCurrentTabId(),
  } = payload;

  const chat = selectChat(global, chatId);
  const fullInfo = selectChatFullInfo(global, chatId);
  if (!chat) {
    return;
  }

  global = getGlobal();
  global = updateManagementProgress(global, ManagementProgress.InProgress, tabId);
  setGlobal(global);

  await Promise.all([
    chat.title !== title
      ? callApi('updateChatTitle', chat, title)
      : undefined,
    fullInfo?.about !== about
      ? callApi('updateChatAbout', chat, about)
      : undefined,
    photo
      ? callApi('editChatPhoto', { chat, photo })
      : undefined,
  ]);

  global = getGlobal();
  global = updateManagementProgress(global, ManagementProgress.Complete, tabId);
  setGlobal(global);

  if (photo) {
    actions.loadFullChat({ chatId, withPhotos: true });
  }
});

addActionHandler('updateChatPhoto', async (global, actions, payload): Promise<void> => {
  const { photo, chatId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  await callApi('editChatPhoto', { chat, photo });
  actions.loadFullChat({ chatId, withPhotos: true });
});

addActionHandler('deleteChatPhoto', async (global, actions, payload): Promise<void> => {
  const { photo, chatId } = payload;
  const chat = selectChat(global, chatId);
  if (!chat) return;

  let isDeleted;
  if (photo.id === chat.avatarPhotoId) {
    isDeleted = await callApi('editChatPhoto', { chat });
  } else {
    isDeleted = await callApi('deleteProfilePhotos', [photo]);
  }
  if (!isDeleted) return;

  global = getGlobal();
  global = deletePeerPhoto(global, chatId, photo.id);
  setGlobal(global);

  actions.loadFullChat({ chatId, withPhotos: true });
});

addActionHandler('setActiveChatFolder', (global, actions, payload): ActionReturnType => {
  const { activeChatFolder, tabId = getCurrentTabId() } = payload;
  const isBlocked = activeChatFolder + 1 > MAX_FOLDERS;

  if (isBlocked) {
    actions.openLimitReachedModal({
      limit: 'dialogFilters',
      tabId,
    });
    return undefined;
  }

  return updateTabState(global, {
    activeChatFolder,
  }, tabId);
});

addActionHandler('resetOpenChatWithDraft', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    requestedDraft: undefined,
  }, tabId);
});

addActionHandler('addChatMembers', async (global, actions, payload): Promise<void> => {
  const { chatId, memberIds, tabId = getCurrentTabId() } = payload;
  const chat = selectChat(global, chatId);
  const users = memberIds.map((userId) => selectUser(global, userId)).filter(Boolean);

  if (!chat || !users.length) {
    return;
  }

  actions.setNewChatMembersDialogState({ newChatMembersProgress: NewChatMembersProgress.Loading, tabId });
  const missingUsers = await callApi('addChatMembers', chat, users);
  if (missingUsers) {
    global = getGlobal();
    global = updateMissingInvitedUsers(global, chatId, missingUsers, tabId);
    setGlobal(global);
  }
  actions.setNewChatMembersDialogState({ newChatMembersProgress: NewChatMembersProgress.Closed, tabId });
  global = getGlobal();
  loadFullChat(global, actions, chat);
});

addActionHandler('deleteChatMember', async (global, actions, payload): Promise<void> => {
  const { chatId, peerId } = payload;
  const chat = selectChat(global, chatId);

  if (!chat) {
    return;
  }

  const user = selectUser(global, peerId);
  if (!user) {
    return;
  }

  await callApi('deleteChatMember', chat, user);
  global = getGlobal();
  loadFullChat(global, actions, chat);
});

addActionHandler('setChatHistoryTtl', (global, actions, payload): ActionReturnType => {
  const { chatId, period } = payload;
  const peer = selectPeer(global, chatId);
  if (!peer) return;

  // The server responds with `updatePeerHistoryTtl`, which is applied by the updater
  void callApi('setHistoryTtl', { peer, period });
});

addActionHandler('fetchChat', (global, actions, payload): ActionReturnType => {
  const { chatId } = payload;
  const chat = selectChat(global, chatId);

  if (chat) {
    return;
  }

  if (selectIsChatWithSelf(global, chatId)) {
    void callApi('fetchChat', { type: 'self' });
  } else {
    const user = selectUser(global, chatId);
    if (user) {
      void callApi('fetchChat', { type: 'user', user });
    }
  }
});

addActionHandler('toggleJoinRequest', async (global, actions, payload): Promise<void> => {
  const {
    chatId, isEnabled, shouldApplyToInvites, tabId = getCurrentTabId(),
  } = payload;

  const chat = await ensureIsSuperGroup(global, actions, chatId, tabId);
  if (!chat) return;

  global = getGlobal();
  const previousIsJoinRequest = selectChat(global, chat.id)?.isJoinRequest;

  global = updateChat(global, chat.id, { isJoinRequest: isEnabled });
  setGlobal(global);

  const result = await callApi('toggleJoinRequest', {
    chat, isEnabled, shouldApplyToInvites,
  });

  if (!result) {
    global = getGlobal();
    global = updateChat(global, chat.id, { isJoinRequest: previousIsJoinRequest });
    setGlobal(global);
  }
});

addActionHandler('openDeleteChatFolderModal', (global, actions, payload): ActionReturnType => {
  const { folderId, tabId = getCurrentTabId() } = payload;
  const folder = selectChatFolder(global, folderId);
  if (!folder) return undefined;

  return updateTabState(global, {
    deleteFolderDialogModal: folderId,
  }, tabId);
});

async function loadChats(
  listType: ChatListType,
  isFullDraftSync?: boolean,
  shouldIgnorePagination?: boolean,
) {
  let global = getGlobal();
  const globalBeforeLoad = global;

  const params = !shouldIgnorePagination ? selectChatListLoadingParameters(global, listType) : {};
  const offsetPeer = params.nextOffsetPeerId ? selectPeer(global, params.nextOffsetPeerId) : undefined;
  const offsetDate = params.nextOffsetDate;
  const offsetId = params.nextOffsetId;

  const isFirstBatch = !shouldIgnorePagination && !offsetPeer && !offsetDate && !offsetId;
  const shouldReplaceStaleState = listType === 'active' && isFirstBatch;
  const isAccountFreeze = selectIsCurrentUserFrozen(global);

  const result = await callApi('fetchChats', {
    limit: CHAT_LIST_LOAD_SLICE,
    offsetDate,
    offsetId,
    offsetPeer,
    archived: listType === 'archived',
    withPinned: isFirstBatch && !isAccountFreeze,
  });

  if (!result) {
    return;
  }

  const { chatIds } = result;

  global = getGlobal();

  global = batchMessageStoreUpdates(global, (chunkGlobal) => {
    const newChats = buildCollectionByKey(result.chats, 'id');

    chunkGlobal = updateUsers(chunkGlobal, buildCollectionByKey(result.users, 'id'));
    chunkGlobal = updateChats(chunkGlobal, newChats);
    if (isFirstBatch) {
      chunkGlobal = replaceChatListIds(chunkGlobal, listType, chatIds);
    } else {
      chunkGlobal = addChatListIds(chunkGlobal, listType, chatIds);
    }

    if (shouldReplaceStaleState) {
      chunkGlobal = replaceUserStatuses(chunkGlobal, result.userStatusesById);
      chunkGlobal = replaceNotifyExceptions(chunkGlobal, result.notifyExceptionById);
    } else {
      chunkGlobal = addUserStatuses(chunkGlobal, result.userStatusesById);
      chunkGlobal = addNotifyExceptions(chunkGlobal, result.notifyExceptionById);
    }

    chunkGlobal = updateChatListSecondaryInfo(chunkGlobal, listType, result);
    chunkGlobal = updateChatsLastMessageId(chunkGlobal, result.lastMessageByChatId);

    if (!shouldIgnorePagination) {
      chunkGlobal = replaceChatListLoadingParameters(
        chunkGlobal, listType, result.nextOffsetId, result.nextOffsetPeerId, result.nextOffsetDate,
      );
    }

    if (isFullDraftSync) {
      result.threadInfos.forEach((threadInfo) => {
        chunkGlobal = updateThreadInfo(chunkGlobal, threadInfo);
      });
      if (result.threadReadStatesById) {
        chunkGlobal = updateMainThreadReadStates(chunkGlobal, result.threadReadStatesById);
      }
    } else {
      // Chats seen for the first time have no local thread to count unread messages in
      result.threadInfos.forEach((threadInfo) => {
        const { chatId } = threadInfo;
        if (selectThreadInfo(chunkGlobal, chatId, MAIN_THREAD_ID)) return;

        chunkGlobal = updateThreadInfo(chunkGlobal, threadInfo);
        chunkGlobal = updateThreadReadState(
          chunkGlobal, chatId, MAIN_THREAD_ID, result.threadReadStatesById[chatId],
        );
      });
    }

    if (listType === 'active' || listType === 'archived') {
      const idsToUpdateDraft = isFullDraftSync ? result.chatIds : Object.keys(result.draftsById);

      idsToUpdateDraft.forEach((chatId) => {
        const draft = result.draftsById[chatId];
        const thread = selectThread(chunkGlobal, chatId, MAIN_THREAD_ID);
        if (!isFullDraftSync && !draft && !thread) return;

        const initialDraft = selectDraft(globalBeforeLoad, chatId, MAIN_THREAD_ID);
        const currentDraft = selectDraft(chunkGlobal, chatId, MAIN_THREAD_ID);
        const shouldKeepLocalDraft = currentDraft?.isLocal;
        if (shouldKeepLocalDraft || shouldKeepCurrentDraft(currentDraft, initialDraft, draft)) return;

        chunkGlobal = replaceThreadLocalStateParam(
          chunkGlobal, chatId, MAIN_THREAD_ID, 'draft', draft,
        );
      });
    }

    if (
      (result.isFullyLoaded || chatIds.length === 0 || chatIds.length === result.totalChatCount)
      && !chunkGlobal.chats.isFullyLoaded[listType]
    ) {
      chunkGlobal = {
        ...chunkGlobal,
        chats: {
          ...chunkGlobal.chats,
          isFullyLoaded: {
            ...chunkGlobal.chats.isFullyLoaded,
            [listType]: true,
          },
        },
      };
    }

    return chunkGlobal;
  });

  setGlobal(global);

  return {
    messages: result.messages,
  };
}

function shouldKeepCurrentDraft(
  currentDraft: ApiDraft | undefined,
  initialDraft: ApiDraft | undefined,
  loadedDraft: ApiDraft | undefined,
) {
  if (currentDraft === initialDraft) return false;
  if (!currentDraft || currentDraft.isLocal) return true;

  return Boolean(currentDraft.date && (!loadedDraft?.date || currentDraft.date >= loadedDraft.date));
}

export async function loadFullChat<T extends GlobalState>(
  global: T, actions: RequiredGlobalActions, chat: ApiChat,
) {
  if (selectIsCurrentUserFrozen(global)) return undefined;
  const result = await callApi('fetchFullChat', chat);
  if (!result) {
    return undefined;
  }

  const {
    chats, userStatusesById, fullInfo, membersCount,
  } = result;

  global = getGlobal();
  global = updateChats(global, buildCollectionByKey(chats, 'id'));

  if (userStatusesById) {
    global = addUserStatuses(global, userStatusesById);
  }

  if (membersCount !== undefined) {
    global = updateChat(global, chat.id, { membersCount });
  }
  global = replaceChatFullInfo(global, chat.id, fullInfo);
  setGlobal(global);

  return result;
}

export async function fetchChatByUsername<T extends GlobalState>(
  global: T,
  username: string,
) {
  global = getGlobal();
  const localChat = selectChatByUsername(global, username);
  if (localChat && !localChat.isMin) {
    return localChat;
  }

  const { chat, user } = await callApi('getChatByUsername', username) || {};
  if (!chat) {
    return undefined;
  }

  global = getGlobal();
  global = updateChat(global, chat.id, chat);
  if (user) {
    global = updateUser(global, user.id, user);
  }

  setGlobal(global);

  return chat;
}

export async function fetchChatByPhoneNumber<T extends GlobalState>(global: T, phoneNumber: string) {
  global = getGlobal();
  const localUser = selectUserByPhoneNumber(global, phoneNumber);
  if (localUser && !localUser.isMin) {
    return selectChat(global, localUser.id);
  }

  // Signal: the contact discovery service finds the user, or tells why it did not
  const result = await callApi('lookUpPhoneNumber', phoneNumber);
  if (!result) return undefined;
  if ('error' in result) return result;
  const { chat, user } = result;

  global = getGlobal();
  global = updateChat(global, chat.id, chat);

  if (user) {
    global = updateUser(global, user.id, user);
  }
  setGlobal(global);

  return chat;
}

async function openChatByUsername<T extends GlobalState>(
  global: T,
  actions: RequiredGlobalActions,
  params: {
    username: string;
    threadId?: ThreadId;
    channelPostId?: number;
    text?: string;
    timestamp?: number;
    linkContext?: LinkContext;
  },
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const {
    username, threadId, channelPostId, text, timestamp, linkContext,
  } = params;
  const currentChat = selectCurrentChat(global, tabId);

  const isCurrentChat = currentChat?.usernames?.some((c) => c.username === username);

  if (!isCurrentChat) {
    // Open temporary empty chat to make the click response feel faster
    actions.openChat({ id: TMP_CHAT_ID, tabId });
  }

  const chat = await fetchChatByUsername(global, username);
  if (!chat) {
    if (!isCurrentChat) {
      actions.openPreviousChat({ tabId });
      actions.showNotification({ message: { key: 'NoUsernameFound' }, tabId });
    }

    return;
  }

  openChatWithParams(global, actions, chat, {
    isCurrentChat,
    threadId,
    messageId: channelPostId,
    text,
    timestamp,
    linkContext,
  }, tabId);
}

function openChatWithParams<T extends GlobalState>(
  global: T,
  actions: RequiredGlobalActions,
  chat: ApiChat,
  params: {
    isCurrentChat?: boolean;
    threadId?: ThreadId;
    messageId?: number;
    text?: string;
    timestamp?: number;
    linkContext?: LinkContext;
  },
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const {
    isCurrentChat, threadId, messageId, text, timestamp, linkContext,
  } = params;

  if (messageId) {
    actions.focusMessage({
      chatId: chat.id, threadId, messageId, timestamp, tabId,
      replyMessageId: linkContext?.type === 'message' ? linkContext.messageId : undefined,
    });
  } else if (!isCurrentChat) {
    actions.openChat({ id: chat.id, tabId });
  }

  if (text) {
    actions.openChatWithDraft({ chatId: chat.id, text: { text }, tabId });
  }

  if (messageId && timestamp) {
    actions.openMediaFromTimestamp({
      chatId: chat.id, threadId, messageId, timestamp, tabId,
    });
  }
}

/**
 * Signal groups are basic groups that have the admins, bans and join requests of supergroups, and no supergroup
 * to migrate to, so every group is returned as it is
 */
export function ensureIsSuperGroup<T extends GlobalState>(
  global: T,
  actions: RequiredGlobalActions,
  chatId: string,
  ..._args: TabArgs<T>
) {
  return Promise.resolve(selectChat(global, chatId));
}
