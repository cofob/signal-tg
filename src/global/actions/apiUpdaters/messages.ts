import type {
  ApiMessage, ApiReactions,
  ApiWebPage,
} from '../../../api/types';
import type { ThreadId } from '../../../types';
import type { RequiredGlobalActions } from '../../index';
import type {
  ActionReturnType, GlobalState, RequiredGlobalState,
} from '../../types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { ARCHIVED_FOLDER_ID } from '../../../config';
import { areDeepEqual } from '../../../util/areDeepEqual';
import { makeMessageTrackKey, makeScheduledMessageTrackKey } from '../../../util/audioPlayback/mediaPool';
import * as playbackController from '../../../util/audioPlayback/playbackController';
import { isUserId } from '../../../util/entities/ids';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { omit, unique,
} from '../../../util/iteratees';
import { buildMessageKey, getMessageKey, isLocalMessageId } from '../../../util/keys/messageKey';
import { buildSearchResultKey } from '../../../util/keys/searchResultKey';
import { notifyAboutMessage } from '../../../util/notifications';
import { onTickEnd } from '../../../util/schedulers';
import {
  checkIfHasUnreadReactions,
  getMessageContent,
  groupMessageIdsByThreadId,
  isActionMessage,
  isDeletedUser,
  isMessageLocal,
  parseSharedMediaKey,
  pickMatchingTypingDraftMessage,
  runForAllTabs,
  WINDOWED_MEDIA_SEARCH_TYPES,
} from '../../helpers';
import { getMessageReplyInfo, getStoryReplyInfo } from '../../helpers/replies';
import {
  addActionHandler,
  getGlobal,
  setGlobal,
} from '../../index';
import { scheduleEphemeralExpiration } from '../../intervals';
import {
  addChatListIds,
  addMessages,
  addViewportId,
  deleteChatMessages,
  deleteChatScheduledMessages,
  deleteEphemeralMessages,
  deletePeerPhoto,
  removeChatFromChatLists,
  replaceWebPage,
  updateChatLastMessageId,
  updateChatMediaLoadingState,
  updateChatMessage,
  updateEphemeralMessage,
  updateListedIds,
  updatePeerFullInfo,
  updatePoll,
  updateScheduledMessage,
} from '../../reducers';
import { appendShufflePlaylist, removeTrackFromShuffle } from '../../reducers/audioPlayer';
import { removeMessagesFromGlobalSearchResults } from '../../reducers/globalSearch';
import { updateTabState } from '../../reducers/tabs';
import {
  replaceThreadLocalStateParam,
  updateThreadInfo,
  updateThreadInfoLastMessageId,
  updateThreadInfoMessagesCount,
  updateThreadReadState,
} from '../../reducers/threads';
import { updateUserFullInfo } from '../../reducers/users';
import {
  selectChat,
  selectChatLastMessageId,
  selectChatMessage,
  selectChatMessages,
  selectChatScheduledMessages,
  selectCommonBoxChatId,
  selectCurrentMessageList,
  selectEphemeralMessage,
  selectFirstUnreadId,
  selectIsChatListed,
  selectIsMessageInCurrentMessageList,
  selectIsViewportNewest,
  selectListedIds,
  selectPerformanceSettingsValue,
  selectPinnedIds,
  selectScheduledIds,
  selectScheduledMessage,
  selectTabState,
  selectUser,
  selectViewportIds,
} from '../../selectors';
import {
  selectIsPlaylistFullyLoaded, selectPlaybackSource, selectPlaylistKeys,
} from '../../selectors/audioPlayer';
import {
  selectThreadInfo,
  selectThreadLocalStateParam,
  selectThreadReadState,
} from '../../selectors/threads';

const ANIMATION_DELAY = 350;

type TypingDraftEntry = {
  randomId: string;
  message: ApiMessage;
};

function getTypingDraftEntries<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
) {
  const typingDraftStore = selectThreadLocalStateParam(global, chatId, threadId, 'typingDraftIdByRandomId');
  const typingDraftEntries = Object.entries(typingDraftStore || {}).reduce((result, [randomId, messageId]) => {
    const message = selectChatMessage(global, chatId, messageId);
    if (!message?.isTypingDraft) {
      return result;
    }

    result.push({ randomId, message });
    return result;
  }, [] as TypingDraftEntry[]);

  return typingDraftEntries;
}

function removeTypingDraftEntries<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  typingDraftEntries: TypingDraftEntry[],
  shouldSkipAnimation?: boolean,
) {
  if (!typingDraftEntries.length) {
    return global;
  }

  const typingDraftStore = selectThreadLocalStateParam(global, chatId, threadId, 'typingDraftIdByRandomId') || {};
  const randomIds = typingDraftEntries.map(({ randomId }) => randomId);
  const nextTypingDraftStore = omit(typingDraftStore, randomIds);
  const messageIdsToDelete = randomIds.reduce((result, randomId) => {
    const messageId = typingDraftStore[randomId];
    const message = messageId ? selectChatMessage(global, chatId, messageId) : undefined;
    if (!message?.isTypingDraft) {
      return result;
    }

    result.push(messageId);
    return result;
  }, [] as number[]);

  global = replaceThreadLocalStateParam(
    global,
    chatId,
    threadId,
    'typingDraftIdByRandomId',
    Object.keys(nextTypingDraftStore).length ? nextTypingDraftStore : undefined,
  );

  if (messageIdsToDelete.length) {
    global = shouldSkipAnimation
      ? deleteChatMessages(global, chatId, messageIdsToDelete)
      : deleteChatMessagesWithAnimation(global, chatId, messageIdsToDelete);
  }

  return global;
}

function shouldBumpCorrespondentTopPeer<T extends GlobalState>(global: T, chatId: string) {
  const user = selectUser(global, chatId);
  return Boolean(user && !user.isSelf && !isDeletedUser(user));
}

function addWebPages<T extends GlobalState>(
  global: T,
  webPages?: ApiWebPage[],
) {
  if (!webPages?.length) {
    return global;
  }

  const addedWebPageIds = new Set<string>();

  webPages.forEach((page) => {
    if (addedWebPageIds.has(page.id)) {
      return;
    }

    global = replaceWebPage(global, page.id, page);
    addedWebPageIds.add(page.id);
  });

  return global;
}

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  switch (update['@type']) {
    case 'updateEphemeralMessage': {
      const { message, webPages } = update;
      if (message.previousLocalId !== undefined) {
        global = deleteEphemeralMessages(global, message.chatId, [message.previousLocalId]);
      }
      global = addWebPages(global, webPages);
      global = updateEphemeralMessage(global, message);
      setGlobal(global);
      scheduleEphemeralExpiration(global);
      break;
    }

    case 'newMessage': {
      const {
        chatId, id, message, shouldForceReply, wasDrafted, poll, webPages,
      } = update;
      const chat = selectChat(global, chatId);
      const isLocal = isMessageLocal(message);
      const threadId = MAIN_THREAD_ID;
      const typingDraftEntries = getTypingDraftEntries(global, chatId, threadId);
      const hasTypingDraftsInThread = Boolean(typingDraftEntries.length);
      const shouldAttemptTypingDraftHandoff = !isLocal && !message.isOutgoing && !message.content.action;

      let matchedTypingDraftEntry: TypingDraftEntry | undefined;
      let shouldClearTypingDraftsAfterRender = false;

      if (hasTypingDraftsInThread && shouldAttemptTypingDraftHandoff) {
        const matchedTypingDraft = pickMatchingTypingDraftMessage(
          message,
          typingDraftEntries.map(({ message: typingDraftMessage }) => typingDraftMessage),
        );

        matchedTypingDraftEntry = matchedTypingDraft
          ? typingDraftEntries.find(
            ({ message: typingDraftMessage }) => typingDraftMessage.id === matchedTypingDraft.id,
          )
          : undefined;
        shouldClearTypingDraftsAfterRender = Boolean(typingDraftEntries.length && !matchedTypingDraftEntry);
      }

      const nextMessage = matchedTypingDraftEntry ? {
        ...message,
        previousLocalId: matchedTypingDraftEntry.message.id,
        isTypingDraft: true,
        wasTypingDraft: true,
      } : message;

      global = updateWithLocalMedia(global, chatId, id, true, nextMessage);
      global = updateListedAndViewportIds(global, nextMessage);

      if (hasTypingDraftsInThread && matchedTypingDraftEntry) {
        global = removeTypingDraftEntries(global, chatId, threadId, [matchedTypingDraftEntry], true);
      }

      const newMessage = selectChatMessage(global, chatId, id)!;
      const replyInfo = getMessageReplyInfo(newMessage);
      const storyReplyInfo = getStoryReplyInfo(newMessage);
      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        // Force update for last message on drafted messages to prevent flickering
        if (isLocal && wasDrafted) {
          global = updateChatLastMessage(global, chatId, newMessage);
        }

        const messageThreadId = MAIN_THREAD_ID;
        WINDOWED_MEDIA_SEARCH_TYPES.forEach((mediaType) => {
          global = updateChatMediaLoadingState(global, newMessage, chatId, messageThreadId, mediaType, tabId);
        });

        const playbackSource = selectPlaybackSource(global, tabId);
        const newKeys = playbackSource?.type === 'chat' && playbackSource.chatId === chatId
          && playbackSource.threadId === messageThreadId
          ? selectPlaylistKeys(global, tabId)?.filter((key) => parseSharedMediaKey(key).messageId === newMessage.id)
          : undefined;
        if (newKeys?.length) {
          global = appendShufflePlaylist(global, newKeys, selectIsPlaylistFullyLoaded(global, tabId), tabId);
        }

        if (selectIsMessageInCurrentMessageList(global, chatId, message, tabId)) {
          if (isLocal && message.isOutgoing && !(message.content?.action) && !storyReplyInfo?.storyId
            && !message.content?.storyData) {
            const currentMessageList = selectCurrentMessageList(global, tabId);
            if (currentMessageList) {
              // We do not use `actions.focusLastMessage` as it may be set with a delay (see below)
              actions.focusMessage({
                chatId,
                threadId: currentMessageList.threadId,
                messageId: message.id,
                noHighlight: true,
                isResizingContainer: true,
                tabId,
              });
            }
          }

          // @perf Wait until scroll animation finishes or simply rely on delivery status update
          // (which is itself delayed)
          if (!isLocal) {
            setTimeout(() => {
              global = getGlobal();
              if (shouldForceReply) {
                actions.updateDraftReplyInfo({
                  replyToMsgId: id,
                  tabId,
                });
              }
              global = updateChatLastMessage(global, chatId, newMessage);
              setGlobal(global);
            }, ANIMATION_DELAY);
          }
        } else {
          global = updateChatLastMessage(global, chatId, newMessage);
        }

        if (!isLocal && message.isOutgoing && message.content?.action?.type === 'noForwardsRequest') {
          const currentMessageList = selectCurrentMessageList(global, tabId);
          if (currentMessageList?.chatId === chatId && currentMessageList.type === 'thread') {
            actions.focusMessage({
              chatId,
              threadId: MAIN_THREAD_ID,
              messageId: message.id,
              noHighlight: true,
              tabId,
            });
          }
        }
      });

      if (poll) {
        global = updatePoll(global, poll.summary.id, poll);
      }

      global = addWebPages(global, webPages);

      if (shouldClearTypingDraftsAfterRender) {
        onTickEnd(() => {
          global = getGlobal();
          global = removeTypingDraftEntries(global, chatId, threadId, typingDraftEntries, true);
          setGlobal(global);
        });
      }

      if (!isLocal && message.content?.action?.type === 'noForwardsToggle') {
        const { newValue } = message.content.action;
        if (message.isOutgoing) {
          global = updateUserFullInfo(global, chatId, {
            noForwardsMyEnabled: newValue,
          });
          const tabId = getCurrentTabId();
          if (selectCurrentMessageList(global, tabId)?.chatId === chatId) {
            actions.showNotification({
              icon: newValue ? 'hand-stop-filled' : 'select-filled',
              message: { key: newValue ? 'NotificationSharingDisabled' : 'NotificationSharingEnabled' },
              tabId,
            });
          }
        } else {
          const originalMessage = replyInfo?.replyToMsgId ?
            selectChatMessage(global, chatId, replyInfo.replyToMsgId) : undefined;

          // When peer accepted user request to enable sharing
          if (originalMessage?.isOutgoing && !newValue) {
            global = updateUserFullInfo(global, chatId, {
              noForwardsMyEnabled: false,
            });
          } else {
            global = updateUserFullInfo(global, chatId, {
              noForwardsPeerEnabled: newValue,
            });
          }
        }
      }

      const chatListType = chat?.folderId === ARCHIVED_FOLDER_ID ? 'archived' : 'active';
      const shouldRestoreChatInList = (
        !isLocal && !isActionMessage(newMessage) && !chat?.isNotJoined
        && !selectIsChatListed(global, chatId, chatListType)
      );
      if (shouldRestoreChatInList && chat) {
        if (global.chats.listIds[chatListType]) {
          global = addChatListIds(global, chatListType, [chatId]);
        }
      }

      setGlobal(global);

      // Reload dialogs if chat is not present in the list
      if (shouldRestoreChatInList) {
        actions.loadTopChats();
      }

      if (!isLocal && message.ttlPeriod) {
        actions.cleanupExpiredTtlMessages({ chatId, messageIds: [id] });
      }

      break;
    }

    case 'updateChatLastMessage': {
      const { id, lastMessage } = update;

      global = updateChatLastMessage(global, id, lastMessage, true);
      global = addMessages(global, [lastMessage]);
      setGlobal(global);
      break;
    }

    case 'newScheduledMessage': {
      const {
        chatId, id, message, poll, webPages,
      } = update;

      global = updateWithLocalMedia(global, chatId, id, true, message, true);

      const scheduledIds = selectScheduledIds(global, chatId, MAIN_THREAD_ID) || [];
      global = replaceThreadLocalStateParam(
        global, chatId, MAIN_THREAD_ID, 'scheduledIds', unique([...scheduledIds, id]),
      );

      const threadId = MAIN_THREAD_ID;
      if (threadId !== MAIN_THREAD_ID) {
        const threadScheduledIds = selectScheduledIds(global, chatId, threadId) || [];
        global = replaceThreadLocalStateParam(
          global, chatId, threadId, 'scheduledIds', unique([...threadScheduledIds, id]),
        );
      }

      if (poll) {
        global = updatePoll(global, poll.summary.id, poll);
      }

      global = addWebPages(global, webPages);

      global = updatePeerFullInfo(global, chatId, {
        hasScheduledMessages: true,
      });

      setGlobal(global);

      break;
    }

    case 'updateScheduledMessage': {
      const {
        chatId, id, message, poll, webPages, isFromNew,
      } = update;

      const currentMessage = selectScheduledMessage(global, chatId, id);
      if (!currentMessage) {
        if (isFromNew) {
          actions.apiUpdate({
            '@type': 'newScheduledMessage',
            id: update.id,
            chatId: update.chatId,
            message: update.message as ApiMessage,
            poll: update.poll,
            webPages: update.webPages,
          });
        }
        return;
      }

      global = updateWithLocalMedia(global, chatId, id, false, message, true);
      const ids = Object.keys(selectChatScheduledMessages(global, chatId) || {}).map(Number).sort((a, b) => b - a);
      global = replaceThreadLocalStateParam(global, chatId, MAIN_THREAD_ID, 'scheduledIds', ids);

      const threadId = MAIN_THREAD_ID;
      if (threadId !== MAIN_THREAD_ID) {
        const threadScheduledIds = selectScheduledIds(global, chatId, threadId) || [];
        global = replaceThreadLocalStateParam(
          global, chatId, threadId, 'scheduledIds', [...threadScheduledIds].sort((a, b) => b - a),
        );
      }
      if (poll) {
        global = updatePoll(global, poll.summary.id, poll);
      }

      global = addWebPages(global, webPages);

      setGlobal(global);

      break;
    }

    case 'updateMessage': {
      const {
        chatId, id, message, poll, webPages, isFromNew, isFull, shouldForceReply,
      } = update;

      const currentMessage = selectChatMessage(global, chatId, id);

      if (message.reactions) {
        global = updateReactions(
          global, actions, {
            chatId,
            id,
            reactions: message.reactions,
          },
        );
      }

      if (poll) {
        global = updatePoll(global, poll.summary.id, poll);
      }

      global = addWebPages(global, webPages);

      if (!currentMessage) {
        if (isFromNew && isFull) {
          actions.apiUpdate({
            '@type': 'newMessage',
            id: update.id,
            chatId: update.chatId,
            message: update.message,
            poll: update.poll,
            webPages: update.webPages,
            shouldForceReply,
          });
        }

        // If update contains the full message, store it
        if (update.isFull) {
          global = addMessages(global, [update.message]);
        }
        setGlobal(global);
        return;
      }

      global = updateWithLocalMedia(global, chatId, id, false, message);

      setGlobal(global);

      break;
    }

    case 'updateMessageSendSucceeded': {
      const {
        chatId, localId, message, poll, webPages,
      } = update;

      global = updateListedAndViewportIds(global, message);

      const currentMessage = selectChatMessage(global, chatId, localId);

      global = deleteChatMessages(global, chatId, [localId], { shouldPreserveMedia: true });

      // Edge case for "Send When Online"
      if (message.isScheduled) {
        global = deleteChatScheduledMessages(global, chatId, [localId]);
      }

      global = updateChatMessage(global, chatId, message.id, {
        ...currentMessage,
        ...message,
        previousLocalId: localId,
        isDeleting: undefined,
      });

      if (poll) {
        global = updatePoll(global, poll.summary.id, poll);
      }

      global = addWebPages(global, webPages);

      global = {
        ...global,
        fileUploads: {
          byMessageKey: omit(global.fileUploads.byMessageKey, [buildMessageKey(chatId, localId)]),
        },
      };

      const newMessage = selectChatMessage(global, chatId, message.id)!;
      global = updateChatLastMessage(global, chatId, newMessage);

      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        const { activeItem, source } = selectTabState(global, tabId).audioPlayer;
        if (activeItem?.type !== 'message' || activeItem.isScheduled
          || activeItem.chatId !== chatId || activeItem.messageId !== localId) return;

        if (tabId === getCurrentTabId()) {
          playbackController.renameTrack(
            makeMessageTrackKey(chatId, localId, activeItem.documentId),
            makeMessageTrackKey(chatId, message.id, activeItem.documentId),
          );
        }
        const { voice, video } = message.content;
        global = updateTabState(global, {
          audioPlayer: {
            ...selectTabState(global, tabId).audioPlayer,
            activeItem: { ...activeItem, messageId: message.id },
            source: source?.type === 'single' ? {
              type: 'chat',
              chatId,
              threadId: activeItem.threadId,
              mediaType: (voice || video) ? 'voice' : 'audio',
            } : source,
          },
        }, tabId);
      });

      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        const { chatId: currentChatId, threadId: currentThreadId } = selectCurrentMessageList(global, tabId) || {};
        if (currentChatId !== chatId || currentThreadId !== MAIN_THREAD_ID) {
          return;
        }

        actions.markMessageListRead({ maxId: message.id, tabId });
      });
      const chat = selectChat(global, chatId);
      // Reload dialogs if chat is not present in the list
      if (!chat?.isNotJoined && !selectIsChatListed(global, chatId)) {
        actions.loadTopChats();
      }

      setGlobal(global);

      if (shouldBumpCorrespondentTopPeer(global, chatId)) {
        actions.bumpTopPeerRating({ category: 'correspondents', peerId: chatId });
      }

      break;
    }

    case 'updateScheduledMessageSendSucceeded': {
      const {
        chatId, localId, message, poll, webPages,
      } = update;
      const scheduledIds = selectScheduledIds(global, chatId, MAIN_THREAD_ID) || [];
      global = replaceThreadLocalStateParam(
        global, chatId, MAIN_THREAD_ID, 'scheduledIds', [...scheduledIds, message.id],
      );

      const threadId = MAIN_THREAD_ID;
      if (threadId !== MAIN_THREAD_ID) {
        const threadScheduledIds = selectScheduledIds(global, chatId, threadId) || [];
        global = replaceThreadLocalStateParam(
          global, chatId, threadId, 'scheduledIds', [...threadScheduledIds, message.id],
        );
      }

      const currentMessage = selectScheduledMessage(global, chatId, localId);

      global = deleteChatScheduledMessages(global, chatId, [localId]);
      global = updateScheduledMessage(global, chatId, message.id, {
        ...currentMessage,
        ...message,
        previousLocalId: localId,
        isDeleting: undefined,
      });
      global = {
        ...global,
        fileUploads: {
          byMessageKey: omit(global.fileUploads.byMessageKey, [buildMessageKey(chatId, localId)]),
        },
      };

      runForAllTabs(global, (tabId) => {
        const { audioPlayer } = selectTabState(global, tabId);
        const { activeItem } = audioPlayer;
        if (activeItem?.type !== 'message' || !activeItem.isScheduled
          || activeItem.chatId !== chatId || activeItem.messageId !== localId) return;

        if (tabId === getCurrentTabId()) {
          playbackController.renameTrack(
            makeScheduledMessageTrackKey(chatId, localId, activeItem.documentId),
            makeScheduledMessageTrackKey(chatId, message.id, activeItem.documentId),
          );
        }
        global = updateTabState(global, {
          audioPlayer: {
            ...audioPlayer,
            activeItem: { ...activeItem, messageId: message.id },
          },
        }, tabId);
      });

      if (poll) {
        global = updatePoll(global, poll.summary.id, poll);
      }

      global = addWebPages(global, webPages);

      setGlobal(global);
      if (shouldBumpCorrespondentTopPeer(global, chatId)) {
        actions.bumpTopPeerRating({ category: 'correspondents', peerId: chatId });
      }
      break;
    }

    case 'updatePinnedIds': {
      const { chatId, isPinned, messageIds } = update;
      const shouldBePinned = Boolean(isPinned);

      messageIds.forEach((id) => {
        global = updateChatMessage(global, chatId, id, { isPinned: shouldBePinned });
      });

      const messageIdsByThreadId = groupMessageIdsByThreadId(global, chatId, messageIds, false);

      Object.entries(messageIdsByThreadId).forEach(([threadId, ids]) => {
        const pinnedIds = selectPinnedIds(global, chatId, threadId) || [];
        const newPinnedIds = isPinned
          ? unique(pinnedIds.concat(ids)).sort((a, b) => b - a)
          : pinnedIds.filter((id) => !ids.includes(id));
        global = replaceThreadLocalStateParam(global, chatId, threadId, 'pinnedIds', newPinnedIds);
      });
      setGlobal(global);

      break;
    }

    case 'updateThreadInfo': {
      const {
        threadInfo,
      } = update;

      global = updateThreadInfo(global, threadInfo);
      setGlobal(global);

      break;
    }

    case 'updateThreadReadState': {
      const {
        chatId, threadId, readState,
      } = update;

      global = updateThreadReadState(global, chatId, threadId, readState);
      setGlobal(global);

      break;
    }

    case 'resetMessages': {
      const { id: chatId } = update;
      const messagesById = selectChatMessages(global, chatId);

      if (messagesById && !isUserId(chatId)) {
        const tabId = getCurrentTabId();
        global = deleteChatMessages(global, chatId, Object.keys(messagesById).map(Number));
        setGlobal(global);
        actions.loadFullChat({ chatId, force: true });
        actions.loadViewportMessages({ chatId, threadId: MAIN_THREAD_ID, tabId });
      }

      break;
    }

    case 'deleteMessages': {
      const { ids, chatId } = update;

      deleteMessages(global, chatId, ids, actions);
      break;
    }

    case 'deleteScheduledMessages': {
      const { ids, newIds, chatId } = update;

      const hadVideoProcessing = ids?.some((id) => (
        selectScheduledMessage(global, chatId, id)?.isVideoProcessingPending
      ));
      const processedVideoId = newIds?.find((id) => {
        const message = selectChatMessage(global, chatId, id);
        return message?.content.video;
      });

      if (hadVideoProcessing && processedVideoId) {
        Object.values(global.byTabId).forEach(({ id: tabId }) => {
          actions.showNotification({
            message: {
              key: 'VideoConversionDone',
            },
            actionText: {
              key: 'VideoConversionView',
            },
            action: {
              action: 'focusMessage',
              payload: {
                chatId,
                messageId: processedVideoId,
                tabId,
              },
            },
            tabId,
          });
        });
      }

      deleteScheduledMessages(chatId, ids, actions, global);
      break;
    }

    case 'deleteHistory': {
      const { chatId } = update;
      const chatMessages = global.messages.byChatId[chatId];
      if (chatMessages) {
        const ids = Object.keys(chatMessages.byId).map(Number);
        global = getGlobal();
        deleteMessages(global, chatId, ids, actions);
      } else {
        actions.requestChatUpdate({ chatId });
      }

      global = getGlobal();
      global = removeChatFromChatLists(global, chatId);
      setGlobal(global);

      break;
    }

    case 'updateMessagePoll': {
      const { pollId, pollUpdate, webPages } = update;

      global = updatePoll(global, pollId, pollUpdate);
      global = addWebPages(global, webPages);

      setGlobal(global);
      break;
    }

    case 'updateMessageSendFailed': {
      const {
        chatId, localId, error, sendError,
      } = update;

      if (error.match(/CHAT_SEND_.+?FORBIDDEN/)) {
        Object.values(global.byTabId).forEach(({ id: tabId }) => {
          actions.showAllowedMessageTypesNotification({ chatId, tabId });
        });
      }

      global = updateChatMessage(global, chatId, localId, { sendingState: 'messageSendingStateFailed', sendError });
      setGlobal(global);
      break;
    }

    case 'updateScheduledMessageSendFailed': {
      const { chatId, localId, error } = update;

      if (error.match(/CHAT_SEND_.+?FORBIDDEN/)) {
        Object.values(global.byTabId).forEach(({ id: tabId }) => {
          actions.showAllowedMessageTypesNotification({ chatId, tabId });
        });
      }

      global = updateScheduledMessage(global, chatId, localId, { sendingState: 'messageSendingStateFailed' });
      setGlobal(global);
      break;
    }
  }
});

function updateReactions<T extends GlobalState>(
  global: T,
  actions: RequiredGlobalActions,
  {
    chatId, id, threadId, reactions,
  }: {
    chatId: string;
    id: number;
    threadId?: ThreadId;
    reactions: ApiReactions;
  },
): T {
  const chat = selectChat(global, chatId);
  const message = selectChatMessage(global, chatId, id);

  if (!chat || !message) {
    return global;
  }

  const currentReactions = message?.reactions;

  // `updateMessageReactions` happens with an interval, so we try to avoid redundant global state updates
  if (currentReactions && areDeepEqual(reactions, currentReactions)) {
    return global;
  }

  global = updateChatMessage(global, chatId, id, { reactions });

  if (!message.isOutgoing) {
    return global;
  }

  const { reaction, isOwn, isUnread } = reactions.recentReactions?.[0] ?? {};
  const reactionEffectsEnabled = selectPerformanceSettingsValue(global, 'reactionEffects');
  if (reactionEffectsEnabled && message && reaction && isUnread && !isOwn) {
    const messageKey = getMessageKey(message);
    // Start reaction only in master tab
    actions.startActiveReaction({ containerId: messageKey, reaction, tabId: getCurrentTabId() });
  }

  const hasUnreadReactionsForMessageInChat = message.reactions && checkIfHasUnreadReactions(global, message.reactions);
  const hasUnreadReactionsInNewReactions = checkIfHasUnreadReactions(global, reactions);

  // Only notify about added reactions, not removed ones
  if (hasUnreadReactionsInNewReactions && !hasUnreadReactionsForMessageInChat) {
    const newMessage = selectChatMessage(global, chatId, id);

    if (!chat || !newMessage) return global;

    onTickEnd(() => {
      notifyAboutMessage({
        chat,
        message: newMessage,
        isReaction: true,
      });
    });
  }

  return global;
}

function updateWithLocalMedia(
  global: RequiredGlobalState,
  chatId: string,
  id: number,
  isNew: boolean,
  messageUpdate: Partial<ApiMessage>,
  isScheduled = false,
) {
  const currentMessage = isScheduled
    ? selectScheduledMessage(global, chatId, id)
    : selectChatMessage(global, chatId, id);

  if (!currentMessage && !isNew) return global;

  // Preserve locally uploaded media.
  if (currentMessage && messageUpdate.content && !isLocalMessageId(id)) {
    const {
      photo, video, document,
    } = getMessageContent(currentMessage);

    if (photo && messageUpdate.content.photo) {
      messageUpdate.content.photo.blobUrl ??= photo.blobUrl;
      messageUpdate.content.photo.thumbnail ??= photo.thumbnail;
    } else if (video && messageUpdate.content.video) {
      messageUpdate.content.video.blobUrl ??= video.blobUrl;
    } else if (document && messageUpdate.content.document) {
      messageUpdate.content.document.previewBlobUrl ??= document.previewBlobUrl;
    }
  }

  const newMessage = currentMessage ? { ...currentMessage, ...messageUpdate } : messageUpdate;

  return isScheduled
    ? updateScheduledMessage(global, chatId, id, newMessage)
    : updateChatMessage(global, chatId, id, newMessage);
}

function updateListedAndViewportIds<T extends GlobalState>(
  global: T, message: ApiMessage,
) {
  const { id, chatId } = message;

  const threadId = MAIN_THREAD_ID;
  const threadInfo = selectThreadInfo(global, chatId, threadId);

  const mainThreadReadState = selectThreadReadState(global, chatId, MAIN_THREAD_ID);
  const isUnreadChatNotLoaded = mainThreadReadState?.unreadCount && !selectListedIds(global, chatId, MAIN_THREAD_ID);

  if (threadId) {
    global = updateListedIds(global, chatId, threadId, [id]);

    Object.values(global.byTabId).forEach(({ id: tabId }) => {
      if (selectIsViewportNewest(global, chatId, threadId, tabId)) {
        // Always keep the first unread message in the viewport list
        const firstUnreadId = selectFirstUnreadId(global, chatId, threadId);
        const candidateGlobal = addViewportId(global, chatId, threadId, id, tabId);
        const newViewportIds = selectViewportIds(candidateGlobal, chatId, threadId, tabId);

        if (!firstUnreadId || newViewportIds!.includes(firstUnreadId)) {
          global = candidateGlobal;
        }
      }
    });

    if (threadInfo) {
      global = updateThreadInfoLastMessageId(global, chatId, threadId, message.id);

      if (!isMessageLocal(message) && !isActionMessage(message)) {
        const newCount = (threadInfo.messagesCount || 0) + 1;
        global = updateThreadInfoMessagesCount(global, chatId, threadId, newCount);
      }
    }
  }

  if (isUnreadChatNotLoaded) {
    return global;
  }

  global = updateListedIds(global, chatId, MAIN_THREAD_ID, [id]);

  Object.values(global.byTabId).forEach(({ id: tabId }) => {
    if (selectIsViewportNewest(global, chatId, MAIN_THREAD_ID, tabId)) {
      // Always keep the first unread message in the viewport list
      const firstUnreadId = selectFirstUnreadId(global, chatId, MAIN_THREAD_ID);
      const candidateGlobal = addViewportId(global, chatId, MAIN_THREAD_ID, id, tabId);
      const newViewportIds = selectViewportIds(candidateGlobal, chatId, MAIN_THREAD_ID, tabId);

      if (!firstUnreadId || newViewportIds!.includes(firstUnreadId)) {
        global = candidateGlobal;
      }
    }
  });

  return global;
}

function updateChatLastMessage<T extends GlobalState>(
  global: T,
  chatId: string,
  message: ApiMessage,
  force = false,
) {
  const currentLastMessageId = selectChatLastMessageId(global, chatId);

  const threadId = MAIN_THREAD_ID;
  global = updateThreadInfoLastMessageId(global, chatId, threadId, message.id);

  if (currentLastMessageId && !force) {
    const isSameOrNewer = (
      currentLastMessageId === message.id || currentLastMessageId === message.previousLocalId
    ) || message.id > currentLastMessageId;

    if (!isSameOrNewer) {
      return global;
    }
  }

  global = updateChatLastMessageId(global, chatId, message.id);

  return global;
}

function findLastMessage<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId = MAIN_THREAD_ID) {
  const byId = selectChatMessages(global, chatId);
  const listedIds = selectListedIds(global, chatId, threadId);

  if (!byId || !listedIds) {
    return undefined;
  }

  let i = listedIds.length;
  while (i--) {
    const message = byId[listedIds[i]];
    if (message && !message.isDeleting) {
      return message;
    }
  }

  return undefined;
}

export function deleteParticipantHistory<T extends GlobalState>(
  global: T,
  chatId: string,
  peerId: string,
  actions: RequiredGlobalActions,
) {
  const byId = selectChatMessages(global, chatId);

  const messageIds = Object.values(byId || {}).filter((message) => {
    return message.senderId === peerId;
  }).map((message) => message.id);

  if (!messageIds.length) {
    return;
  }

  deleteMessages(global, chatId, messageIds, actions);
}

export function deleteThread<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  actions: RequiredGlobalActions,
) {
  const byId = selectChatMessages(global, chatId);

  const messageIds = Object.values(byId || {}).filter((message) => {
    const messageThreadId = MAIN_THREAD_ID;
    return messageThreadId === threadId;
  }).map((message) => message.id);

  if (!messageIds.length) {
    return;
  }

  deleteMessages(global, chatId, messageIds, actions);
}

export function deleteMessages<T extends GlobalState>(
  global: T, chatId: string | undefined, ids: number[], actions: RequiredGlobalActions,
) {
  // Channel update

  if (chatId) {
    const chat = selectChat(global, chatId);
    if (!chat) {
      setGlobal(global);
      return;
    }

    const threadIdsToUpdate = new Set<ThreadId>();
    threadIdsToUpdate.add(MAIN_THREAD_ID);

    global = deleteChatMessagesWithAnimation(global, chatId, ids);

    ids.forEach((id) => {
      const message = selectChatMessage(global, chatId, id);
      if (!message) {
        return;
      }

      if (message.content.action?.type === 'chatEditPhoto' && message.content.action.photo) {
        global = deletePeerPhoto(global, chatId, message.content.action.photo.id, true);
      }

      const threadId = MAIN_THREAD_ID;
      if (threadId) {
        threadIdsToUpdate.add(threadId);
      }
    });

    actions.requestChatUpdate({ chatId });

    const idsSet = new Set(ids);

    Object.values(global.byTabId).forEach(({ id: tabId }) => {
      const { activeItem, source } = selectTabState(global, tabId).audioPlayer;
      if (activeItem?.type === 'message' && !activeItem.isScheduled
        && activeItem.chatId === chatId && idsSet.has(activeItem.messageId)) {
        actions.closeAudioPlayer({ tabId });
      }

      global = removeMessagesFromGlobalSearchResults(global, chatId, ids, tabId);

      if (source?.type === 'chat' && source.chatId === chatId) {
        ids.forEach((id) => {
          global = removeTrackFromShuffle(global, id, tabId);
        });
      } else if (source?.type === 'globalSearch') {
        ids.forEach((id) => {
          global = removeTrackFromShuffle(global, buildSearchResultKey(chatId, id), tabId);
        });
      }
    });

    threadIdsToUpdate.forEach((threadId) => {
      const threadInfo = selectThreadInfo(global, chatId, threadId);
      if (!threadInfo?.lastMessageId || !idsSet.has(threadInfo.lastMessageId)) return;

      const newLastMessage = findLastMessage(global, chatId, threadId);

      if (!newLastMessage) {
        return;
      }

      if (threadId === MAIN_THREAD_ID) {
        global = updateChatLastMessage(global, chatId, newLastMessage, true);
      }

      global = updateThreadInfoLastMessageId(global, chatId, threadId, newLastMessage.id);
    });

    setGlobal(global);

    return;
  }

  // Common box update

  const chatIdsToUpdate: string[] = [];

  ids.forEach((id) => {
    const commonBoxChatId = selectCommonBoxChatId(global, id);
    if (commonBoxChatId) {
      chatIdsToUpdate.push(commonBoxChatId);

      global = deleteChatMessagesWithAnimation(global, commonBoxChatId, [id]);

      const newLastMessage = findLastMessage(global, commonBoxChatId);
      if (newLastMessage) {
        global = updateChatLastMessage(global, commonBoxChatId, newLastMessage, true);
      }

      const message = selectChatMessage(global, commonBoxChatId, id);
      if (message?.content.action?.type === 'chatEditPhoto' && message.content.action.photo) {
        global = deletePeerPhoto(global, commonBoxChatId, message.content.action.photo.id, true);
      }

      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        const { activeItem, source } = selectTabState(global, tabId).audioPlayer;
        if (activeItem?.type === 'message' && !activeItem.isScheduled
          && activeItem.chatId === commonBoxChatId && activeItem.messageId === id) {
          actions.closeAudioPlayer({ tabId });
        }

        global = removeMessagesFromGlobalSearchResults(global, commonBoxChatId, [id], tabId);

        if (source?.type === 'chat' && source.chatId === commonBoxChatId) {
          global = removeTrackFromShuffle(global, id, tabId);
        } else if (source?.type === 'globalSearch') {
          global = removeTrackFromShuffle(global, buildSearchResultKey(commonBoxChatId, id), tabId);
        }
      });
    }
  });

  setGlobal(global);

  unique(chatIdsToUpdate).forEach((id) => {
    actions.requestChatUpdate({ chatId: id });
  });
}

function deleteChatMessagesWithAnimation<T extends GlobalState>(global: T, chatId: string, ids: number[]) {
  ids.forEach((id) => {
    global = updateChatMessage(global, chatId, id, { isDeleting: true });
  });

  setTimeout(() => {
    global = getGlobal();
    // Prevent local deletion of sent messages in case of desync
    const stillDeletedIds = ids.filter((id) => selectChatMessage(global, chatId, id)?.isDeleting);
    global = deleteChatMessages(global, chatId, stillDeletedIds);
    setGlobal(global);
  }, ANIMATION_DELAY);

  return global;
}

export function deleteEphemeralMessagesWithAnimation<T extends GlobalState>(
  global: T, chatId: string, ids: number[],
) {
  const messages = ids
    .map((id) => selectEphemeralMessage(global, chatId, id))
    .filter(Boolean);
  if (!messages.length) return;

  messages.forEach((message) => {
    if (message.anchorMsgId) {
      global = deleteEphemeralMessages(global, chatId, [message.id]);
      return;
    }
    global = updateEphemeralMessage(global, {
      ...message,
      isDeleting: true,
    });
  });
  setGlobal(global);

  setTimeout(() => {
    global = getGlobal();
    const stillDeletingIds = messages
      .map(({ id }) => id)
      .filter((id) => selectEphemeralMessage(global, chatId, id)?.isDeleting);
    global = deleteEphemeralMessages(global, chatId, stillDeletingIds);
    setGlobal(global);
    scheduleEphemeralExpiration(global);
  }, ANIMATION_DELAY);
}

function deleteScheduledMessages<T extends GlobalState>(
  chatId: string, ids: number[], actions: RequiredGlobalActions, global: T,
) {
  ids.forEach((id) => {
    global = updateScheduledMessage(global, chatId, id, {
      isDeleting: true,
    });
  });

  setGlobal(global);

  const idsSet = new Set(ids);
  runForAllTabs(global, (tabId) => {
    const { activeItem } = selectTabState(global, tabId).audioPlayer;
    if (activeItem?.type === 'message' && activeItem.isScheduled
      && activeItem.chatId === chatId && idsSet.has(activeItem.messageId)) {
      actions.closeAudioPlayer({ tabId });
    }
  });

  setTimeout(() => {
    global = getGlobal();
    global = deleteChatScheduledMessages(global, chatId, ids);
    setGlobal(global);
  }, ANIMATION_DELAY);
}
