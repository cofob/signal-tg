import type {
  ApiChat,
  ApiInputDraftReplyInfo,
  ApiInputMessageReplyInfo,
  ApiMessage,
  ApiMessageForwardInfo,
  ApiMessageOutgoingStatus,
  ApiMessageReplyInfo,
  ApiPeer,
  MediaContainer,
} from '../../api/types';
import type {
  MessageListType,
  ThreadId,
} from '../../types';
import type { IAllowedAttachmentOptions } from '../helpers';
import type {
  GlobalState, TabArgs,
} from '../types';
import { MAIN_THREAD_ID } from '../../api/types';

import {
  TMP_CHAT_ID,
} from '../../config';
import { isUserId } from '../../util/entities/ids';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import { getMessageKey, isLocalMessageId } from '../../util/keys/messageKey';
import { isIpRevealingMedia } from '../../util/media/ipRevealingMedia';
import { getServerTime } from '../../util/serverTime';
import { getDocumentExtension } from '../../components/common/helpers/documentInfo';
import { API_GENERAL_ID_LIMIT } from '../../limits';
import {
  canSendReaction,
  getAllowedAttachmentOptions,
  getCanPostInChat,
  getHasAdminRight,
  getMessageAudio,
  getMessageDocument,
  getMessagePhoto,
  getMessageVideo,
  getMessageVoice,
  getSendingState,
  getWebPagePhoto,
  getWebPageVideo,
  hasMessageTtl,
  isActionMessage,
  isChatBasicGroup,
  isChatGroup,
  isCommonBoxChat,
  isExpiredMessage,
  isForwardedMessage,
  isMessageDocumentSticker,
  isMessageFailed,
  isMessageLocal,
  isOwnMessage,
  isUserRightBanned,
  prepareMessageReplyInfo,
} from '../helpers';
import {
  selectChat,
  selectChatFullInfo,
  selectChatLastMessageId,
  selectIsChatRestricted,
  selectIsChatWithSelf,
} from './chats';
import { selectMessageDownloadableMedia } from './media';
import { selectPeer } from './peers';
import { selectPeerStory } from './stories';
import { selectTabState } from './tabs';
import {
  selectEditingId,
  selectEditingScheduledId,
  selectTabThreadParam,
  selectThreadInfo,
  selectThreadLocalStateParam,
  selectThreadReadState,
} from './threads';
import {
  selectIsCurrentUserFrozen, selectIsUserChatProtected, selectUser, selectUserFullInfo, selectUserStatus,
} from './users';

export function selectCurrentMessageList<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageLists } = selectTabState(global, tabId);

  if (messageLists.length) {
    return messageLists[messageLists.length - 1];
  }

  return undefined;
}

export function selectCanOpenMessageList<T extends GlobalState>(
  global: T,
  chatId: string | undefined,
  threadId: ThreadId | undefined,
  type: MessageListType = 'thread',
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  if (!selectTabState(global, tabId).richMediaUploadBlockingCount) return true;

  const currentMessageList = selectCurrentMessageList(global, tabId);
  return Boolean(currentMessageList
    && currentMessageList.chatId === chatId
    && currentMessageList.threadId === threadId
    && currentMessageList.type === type);
}

export function selectCurrentChat<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { chatId } = selectCurrentMessageList(global, tabId) || {};

  return chatId ? selectChat(global, chatId) : undefined;
}

export function selectChatMessages<T extends GlobalState>(global: T, chatId: string) {
  return global.messages.byChatId[chatId]?.byId;
}

export function selectStoppableTypingDraftId<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  const drafts = selectThreadLocalStateParam(global, chatId, threadId, 'typingDraftIdByRandomId');
  if (!drafts) return undefined;

  for (const [randomId, messageId] of Object.entries(drafts)) {
    const message = selectChatMessage(global, chatId, messageId);
    if (message?.isTypingDraft && message.typingDraft?.canStop) return randomId;
  }

  return undefined;
}

export function selectChatEphemeralMessages<T extends GlobalState>(global: T, chatId: string) {
  return global.messages.byChatId[chatId]?.ephemeralById;
}

export function selectChatAnchoredMessages<T extends GlobalState>(global: T, chatId: string) {
  return global.messages.byChatId[chatId]?.anchoredById;
}

export function selectChatScheduledMessages<T extends GlobalState>(global: T, chatId: string) {
  return global.scheduledMessages.byChatId[chatId]?.byId;
}

export function selectListedIds<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'listedIds');
}

export function selectOutlyingListByMessageId<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, messageId: number,
) {
  const outlyingLists = selectOutlyingLists(global, chatId, threadId);
  if (!outlyingLists) {
    return undefined;
  }

  return outlyingLists.find((list) => {
    return list[0] <= messageId && list[list.length - 1] >= messageId;
  });
}

export function selectOutlyingLists<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId,
) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'outlyingLists');
}

export function selectCurrentMessageIds<T extends GlobalState>(
  global: T,
  chatId: string, threadId: ThreadId, messageListType: MessageListType,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  switch (messageListType) {
    case 'thread':
      return selectViewportIds(global, chatId, threadId, tabId);
    case 'pinned':
      return selectPinnedIds(global, chatId, threadId);
    case 'scheduled':
      return selectScheduledIds(global, chatId, threadId);
  }

  return undefined;
}

export function selectViewportIds<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectTabThreadParam(global, chatId, threadId, 'viewportIds', tabId);
}

export function selectPinnedIds<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'pinnedIds');
}

export function selectScheduledIds<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'scheduledIds');
}

export function selectFirstMessageId<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  return selectThreadLocalStateParam(global, chatId, threadId, 'firstMessageId');
}

export function selectIsMessageInCurrentMessageList<T extends GlobalState>(
  global: T, chatId: string, message: ApiMessage,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList) {
    return false;
  }

  return chatId === currentMessageList.chatId && currentMessageList.threadId === MAIN_THREAD_ID;
}

export function selectIsViewportNewest<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const viewportIds = selectViewportIds(global, chatId, threadId, tabId);
  if (!viewportIds || !viewportIds.length) {
    return true;
  }

  let lastMessageId: number;

  if (threadId === MAIN_THREAD_ID) {
    const id = selectChatLastMessageId(global, chatId);
    if (!id) {
      return true;
    }
    lastMessageId = id;
  } else {
    const threadInfo = selectThreadInfo(global, chatId, threadId);
    if (!threadInfo || !threadInfo.lastMessageId) {
      if (!threadInfo?.threadId) return undefined;
      // No messages in thread, except for the thread message itself
      lastMessageId = Number(threadInfo?.threadId);
    } else {
      lastMessageId = threadInfo.lastMessageId;
    }
  }

  // Edge case: outgoing `lastMessage` is updated with a delay to optimize animation
  if (isLocalMessageId(lastMessageId) && !selectChatMessage(global, chatId, lastMessageId)) {
    return true;
  }

  return viewportIds[viewportIds.length - 1] >= lastMessageId;
}

export function selectChatMessage<T extends GlobalState>(global: T, chatId: string, messageId: number) {
  const chatMessages = selectChatMessages(global, chatId);

  return chatMessages ? chatMessages[messageId] : undefined;
}

export function selectEphemeralMessage<T extends GlobalState>(global: T, chatId: string, messageId: number) {
  const ephemeralById = selectChatEphemeralMessages(global, chatId);
  if (!ephemeralById) return undefined;
  const ephemeralId = selectChatAnchoredMessages(global, chatId)?.[messageId]?.ephemeralId;
  return ephemeralById[ephemeralId || messageId];
}

export function selectChatMessageOrEphemeral<T extends GlobalState>(
  global: T, chatId: string, messageId: number,
) {
  const ephemeral = selectChatEphemeralMessages(global, chatId)?.[messageId];
  const anchorId = ephemeral?.anchorMsgId || messageId;
  return selectChatAnchoredMessages(global, chatId)?.[anchorId]
    || selectChatMessage(global, chatId, anchorId) || ephemeral;
}

export function selectScheduledMessage<T extends GlobalState>(global: T, chatId: string, messageId: number) {
  const chatMessages = selectChatScheduledMessages(global, chatId);

  return chatMessages ? chatMessages[messageId] : undefined;
}

export function selectEditingMessage<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, messageListType: MessageListType,
) {
  if (messageListType === 'scheduled') {
    const messageId = selectEditingScheduledId(global, chatId);
    return messageId ? selectScheduledMessage(global, chatId, messageId) : undefined;
  } else {
    const messageId = selectEditingId(global, chatId, threadId);
    return messageId ? selectChatMessage(global, chatId, messageId) : undefined;
  }
}

export function selectFocusedMessageId<T extends GlobalState>(
  global: T, chatId: string, ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { chatId: focusedChatId, messageId } = selectTabState(global, tabId).focusedMessage || {};

  return focusedChatId === chatId ? messageId : undefined;
}

export function selectIsMessageFocused<T extends GlobalState>(
  global: T, message: ApiMessage, currentThreadId: ThreadId,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const focusedId = selectFocusedMessageId(global, message.chatId, tabId);
  const threadId = selectTabState(global, tabId).focusedMessage?.threadId;

  if (currentThreadId !== threadId) return false;

  return focusedId ? focusedId === message.id || focusedId === message.previousLocalId : false;
}

export function selectIsMessageUnread<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, messageId: number, messageListType: MessageListType,
) {
  const { lastReadOutboxMessageId } = selectThreadReadState(global, chatId, threadId) || {};
  const message = selectChatMessage(global, chatId, messageId);
  if (!message) {
    return false;
  }

  return messageListType === 'scheduled' || isMessageLocal(message)
    || !lastReadOutboxMessageId || lastReadOutboxMessageId < message.id;
}

export function selectOutgoingStatus<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, messageId: number, messageListType: MessageListType,
): ApiMessageOutgoingStatus {
  const message = selectChatMessage(global, chatId, messageId);
  // A message that did not reach everyone keeps showing it, even when a later message was read
  const sendingState = message && getSendingState(message);
  if (sendingState === 'failed' || sendingState === 'partial') return sendingState;

  if (!selectIsMessageUnread(global, chatId, threadId, messageId, messageListType)) {
    return 'read';
  }

  if (!message) {
    return 'failed'; // Should never happen
  }

  return getSendingState(message);
}

export function selectEphemeralOutgoingStatus<T extends GlobalState>(
  global: T, chatId: string, messageId: number,
): ApiMessageOutgoingStatus {
  const message = selectEphemeralMessage(global, chatId, messageId);
  if (!message) {
    return 'failed'; // Should never happen
  }

  return getSendingState(message);
}

export function selectSender<T extends GlobalState>(global: T, message: ApiMessage): ApiPeer | undefined {
  const { senderId } = message;
  const chat = selectChat(global, message.chatId);
  const currentUser = selectUser(global, global.currentUserId!);
  if (!senderId) {
    return message.isOutgoing ? currentUser : chat;
  }

  return selectPeer(global, senderId);
}

export function getSendersFromSelectedMessages<T extends GlobalState>(
  global: T,
  chatId: string,
  messageIds: number[],
) {
  return messageIds.map((id) => {
    const message = selectChatMessage(global, chatId, id);
    return message && selectSender(global, message);
  }).filter(Boolean);
}

export function selectSenderFromMessage<T extends GlobalState>(
  global: T,
  chatId: string,
  messageId: number,
): ApiPeer | undefined {
  const message = selectChatMessage(global, chatId, messageId);

  return message && selectSender(global, message);
}

export function selectSenderFromHeader<T extends GlobalState>(
  global: T,
  header: ApiMessageForwardInfo,
) {
  const { fromId } = header;
  if (fromId) {
    return selectPeer(global, fromId);
  }

  return undefined;
}

export function selectForwardedSender<T extends GlobalState>(
  global: T, message: ApiMessage,
): ApiPeer | undefined {
  const isStoryForward = Boolean(message.content.storyData);
  if (isStoryForward) {
    const peerId = message.content.storyData!.peerId;
    return selectPeer(global, peerId);
  }

  const { forwardInfo } = message;
  if (!forwardInfo) {
    return undefined;
  }

  if (forwardInfo.isChannelPost && forwardInfo.fromChatId) {
    return selectChat(global, forwardInfo.fromChatId);
  }

  if (forwardInfo.hiddenUserName) {
    return undefined;
  }

  if (forwardInfo.fromId) {
    return selectPeer(global, forwardInfo.fromId);
  }

  if (forwardInfo.savedFromPeerId) {
    return selectPeer(global, forwardInfo.savedFromPeerId);
  }

  return undefined;
}

export function selectPoll<T extends GlobalState>(global: T, pollId: string) {
  return global.messages.pollById[pollId];
}

export function selectPollFromMessage<T extends GlobalState>(global: T, message: MediaContainer) {
  if (!message.content.pollId) return undefined;
  return selectPoll(global, message.content.pollId);
}

export function selectReplyOptionText(
  global: GlobalState, media: MediaContainer, { pollOption, replyOptionText }: ApiMessageReplyInfo,
) {
  if (pollOption !== undefined) {
    const poll = selectPollFromMessage(global, media);
    return poll?.summary.answers.find((answer) => answer.option === pollOption)?.text ?? replyOptionText;
  }
  return undefined;
}

export function selectWebPage<T extends GlobalState>(global: T, webPageId: string) {
  return global.messages.webPageById[webPageId];
}

export function selectWebPagePreview<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  const webPageId = selectThreadLocalStateParam(global, chatId, threadId, 'webPagePreviewId');
  return webPageId ? selectWebPage(global, webPageId) : undefined;
}

export function selectWebPageFromMessage<T extends GlobalState>(global: T, message: MediaContainer) {
  if (!message.content.webPage) return undefined;
  return selectWebPage(global, message.content.webPage.id);
}

function selectFullWebPage<T extends GlobalState>(global: T, webPageId: string) {
  const webPage = selectWebPage(global, webPageId);
  if (!webPage || webPage.webpageType !== 'full') return undefined;
  return webPage;
}

export function selectFullWebPageFromMessage<T extends GlobalState>(global: T, message: MediaContainer) {
  if (!message.content.webPage) return undefined;
  return selectFullWebPage(global, message.content.webPage.id);
}

export function selectCanReplyToMessage<T extends GlobalState>(global: T, message: ApiMessage, threadId: ThreadId) {
  const chat = selectChat(global, message.chatId);
  const isRestricted = selectIsChatRestricted(global, message.chatId);
  if (!chat || isRestricted || chat.isForbidden) return false;

  const isLocal = isMessageLocal(message);

  if (isLocal) return false;

  return getCanPostInChat(chat);
}

export function selectCanPostInMessageList<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, messageListType: MessageListType,
) {
  if (chatId === TMP_CHAT_ID || messageListType === 'pinned') return false;

  const userFullInfo = selectUserFullInfo(global, chatId);
  if (userFullInfo?.isBlocked) return false;

  const chat = selectChat(global, chatId);
  if (selectIsCurrentUserFrozen(global)) return false;
  if (!chat) return true;

  if (!getCanPostInChat(chat)) return false;

  return !(chat.isNotJoined && chat.isJoinRequest);
}

export function selectCanForwardMessage<T extends GlobalState>(global: T, message: ApiMessage) {
  if (message.anchorMsgId) return false;

  const isLocal = isMessageLocal(message);
  const isAction = isActionMessage(message);
  const hasTtl = hasMessageTtl(message);
  const { content } = message;

  const webPage = selectFullWebPageFromMessage(global, message);

  const story = content.storyData
    ? selectPeerStory(global, content.storyData.peerId, content.storyData.id)
    : (webPage?.story
      ? selectPeerStory(global, webPage.story.peerId, webPage.story.id)
      : undefined
    );
  const isChatProtected = selectIsChatProtected(global, message.chatId);
  const isStoryForwardForbidden = story && ('isDeleted' in story || ('noForwards' in story && story.noForwards));
  const canForward = (
    !isLocal && !isAction && !isChatProtected && !isStoryForwardForbidden
    && message.isForwardingAllowed && !hasTtl
  );

  return canForward;
}

// This selector is slow and not to be used within lists (e.g. Message component)
export function selectAllowedMessageActionsSlow<T extends GlobalState>(
  global: T, message: ApiMessage, threadId: ThreadId,
) {
  const chat = selectChat(global, message.chatId);
  const isRestricted = selectIsChatRestricted(global, message.chatId);
  if (!chat || isRestricted) {
    return {};
  }

  const isPrivate = isUserId(chat.id);
  const isChatWithSelf = selectIsChatWithSelf(global, message.chatId);
  const isBasicGroup = isChatBasicGroup(chat);
  const isLocal = isMessageLocal(message);
  const isFailed = isMessageFailed(message);
  const isOwn = isOwnMessage(message);
  const isForwarded = isForwardedMessage(message);
  const isAction = isActionMessage(message);
  const hasTtl = hasMessageTtl(message);
  const { content } = message;
  const isDocumentSticker = isMessageDocumentSticker(message);

  const canPinMessage = isPrivate || (
    !chat.isForbidden && !chat.isNotJoined
    && (getHasAdminRight(chat, 'pinMessages') || !isUserRightBanned(chat, 'pinMessages'))
  );

  // https://github.com/telegramdesktop/tdesktop/blob/335095a332607c41a8d20b47e61f5bbd66366d4b/Telegram/SourceFiles/data/data_peer.cpp#L653
  const canEditMessagesIndefinitely = isPrivate && isChatWithSelf;

  const isMessageEditable = (
    (
      canEditMessagesIndefinitely
      || getServerTime() - message.date < (global.config?.editTimeLimit || Infinity)
    ) && !(
      content.sticker || content.contact || content.pollId || content.action
      || (content.video?.isRound) || isDocumentSticker || content.dice
    )
    && !isForwarded
    && !chat.isForbidden
  );

  const canReply = selectCanReplyToMessage(global, message, threadId);
  const canReplyGlobally = canReply || (!isLocal && isBasicGroup);

  let canPin = !isLocal && !isAction && canPinMessage;
  let canUnpin = false;

  const pinnedMessageIds = selectPinnedIds(global, chat.id, threadId);

  if (canPin) {
    canUnpin = Boolean(pinnedMessageIds && pinnedMessageIds.includes(message.id));
    canPin = !canUnpin;
  }

  const canDelete = (!isLocal || isFailed) && (
    isPrivate
    || isOwn
    || isBasicGroup
    || getHasAdminRight(chat, 'deleteMessages')
  );

  const canDeleteForAll = canDelete && !chat.isForbidden && (
    (isPrivate && !isChatWithSelf && !content.dice)
    || (isBasicGroup && (
      isOwn || getHasAdminRight(chat, 'deleteMessages')
    ))
  );

  const hasMessageEditRight = isOwn;

  const isUploading = selectUploadProgress(global, message) !== undefined;
  const canEdit = !isLocal && !isAction && !isUploading && isMessageEditable && hasMessageEditRight;

  const canCopy = !isAction;
  const canSelect = !isLocal && !isAction;
  const sendingState = isOwn ? getSendingState(message) : undefined;
  const canViewDetails = isOwn && !isLocal && !isAction;
  const canResend = !isLocal && (sendingState === 'failed' || sendingState === 'partial');

  const canDownload = selectMessageDownloadableMedia(global, message) && !hasTtl;

  const poll = content.pollId ? selectPoll(global, content.pollId) : undefined;
  const hasChosenPollAnswer = Boolean(
    poll && Object.values(poll.results.resultByOption || {}).some((result) => result.isChosen),
  );
  const canRevote = poll && !poll.summary.isClosed && !poll.summary.isRevoteDisabled
    && hasChosenPollAnswer;
  const canClosePoll = hasMessageEditRight && poll && !poll.summary.isClosed && !isForwarded;

  const noOptions = [
    canReply,
    canReplyGlobally,
    canEdit,
    canPin,
    canUnpin,
    canDelete,
    canDeleteForAll,
    canCopy,
    canSelect,
    canDownload,
    canRevote,
    canClosePoll,
    canViewDetails,
    canResend,
  ].every((ability) => !ability);

  return {
    noOptions,
    canReply,
    canReplyGlobally,
    canEdit,
    canPin,
    canUnpin,
    canDelete,
    canDeleteForAll,
    canCopy,
    canSelect,
    canDownload,
    canRevote,
    canClosePoll,
    canViewDetails,
    canResend,
  };
}

export function selectCanDeleteMessages<T extends GlobalState>(
  global: T,
  chatId: string,
  threadId: ThreadId,
  messageIds: number[],
) {
  const chatMessages = selectChatMessages(global, chatId);

  if (messageIds.length > API_GENERAL_ID_LIMIT) {
    return {};
  }

  const messageActions = messageIds
    .map((id) => chatMessages[id] && selectAllowedMessageActionsSlow(global, chatMessages[id], threadId))
    .filter(Boolean);

  return {
    canDelete: messageActions.every((actions) => actions.canDelete),
    canDeleteForAll: messageActions.every((actions) => actions.canDeleteForAll),
  };
}

export function selectCanDeleteSelectedMessages<T extends GlobalState>(
  global: T,
  messageIds?: number[],
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageIds: selectedMessageIds } = selectTabState(global, tabId).selectedMessages || {};
  const { chatId, threadId } = selectCurrentMessageList(global, tabId) || {};
  const messageIdList = messageIds?.length ? messageIds : selectedMessageIds;
  if (!chatId || !threadId || !messageIdList) {
    return {};
  }

  return selectCanDeleteMessages(global, chatId, threadId, messageIdList);
}

export function selectCanDownloadSelectedMessages<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageIds: selectedMessageIds } = selectTabState(global, tabId).selectedMessages || {};
  const { chatId, threadId } = selectCurrentMessageList(global, tabId) || {};
  const chatMessages = chatId && selectChatMessages(global, chatId);
  if (!chatMessages || !selectedMessageIds || !threadId) {
    return false;
  }

  const messageActions = selectedMessageIds
    .map((id) => chatMessages[id] && selectAllowedMessageActionsSlow(global, chatMessages[id], threadId))
    .filter(Boolean);

  return messageActions.some((actions) => actions.canDownload);
}

export function selectActiveDownloads<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectTabState(global, tabId).activeDownloads;
}

export function selectIsFileSaved<T extends GlobalState>(
  global: T,
  key: string | undefined,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return Boolean(key && selectTabState(global, tabId).savedFiles[key]);
}

export function selectUploadProgress<T extends GlobalState>(global: T, message: ApiMessage) {
  return global.fileUploads.byMessageKey[getMessageKey(message)]?.progress;
}

export function selectRealLastReadId<T extends GlobalState>(global: T, chatId: string, threadId: ThreadId) {
  const readState = selectThreadReadState(global, chatId, threadId);
  if (!readState) {
    return undefined;
  }

  // `lastReadInboxMessageId` is empty for new chats
  if (!readState.lastReadInboxMessageId) {
    // For new comments, mark thread start as the last read
    if (threadId !== MAIN_THREAD_ID && readState.unreadCount && typeof threadId === 'number') {
      return threadId;
    }

    return undefined;
  }

  const lastMessageId = selectChatLastMessageId(global, chatId);

  if (!lastMessageId || readState.unreadCount) {
    return readState.lastReadInboxMessageId;
  }

  return lastMessageId;
}

export function selectFirstUnreadId<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId,
) {
  const chat = selectChat(global, chatId);

  if (threadId === MAIN_THREAD_ID) {
    if (!chat) {
      return undefined;
    }
  } else {
    const threadInfo = selectThreadInfo(global, chatId, threadId);
    const readState = selectThreadReadState(global, chatId, threadId);
    if (!threadInfo || !readState
      || (threadInfo.lastMessageId !== undefined && threadInfo.lastMessageId === readState.lastReadInboxMessageId)) {
      return undefined;
    }
  }

  const outlyingLists = selectOutlyingLists(global, chatId, threadId);
  const listedIds = selectListedIds(global, chatId, threadId);
  const byId = selectChatMessages(global, chatId);
  if (!byId || !(outlyingLists?.length || listedIds)) {
    return undefined;
  }

  const lastReadId = selectRealLastReadId(global, chatId, threadId);
  if (!lastReadId && chat && chat.isNotJoined) {
    return undefined;
  }

  function findAfterLastReadId(listIds: number[]) {
    return listIds.find((id) => {
      return (
        (!lastReadId || id > lastReadId)
        && byId[id]
        && !byId[id].isTypingDraft
        && (!byId[id].isOutgoing || byId[id].isFromScheduled)
      );
    });
  }

  if (outlyingLists?.length) {
    const found = outlyingLists.map((list) => findAfterLastReadId(list)).filter(Boolean)[0];
    if (found) {
      return found;
    }
  }

  if (listedIds) {
    const found = findAfterLastReadId(listedIds);
    if (found) {
      return found;
    }
  }

  return undefined;
}

export function selectIsForwardModalOpen<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { isShareMessageModalShown } = selectTabState(global, tabId);
  return Boolean(isShareMessageModalShown);
}

export function selectCommonBoxChatId<T extends GlobalState>(global: T, messageId: number) {
  const fromLastMessage = Object.values(global.chats.byId).find((chat) => (
    isCommonBoxChat(chat) && selectChatLastMessageId(global, chat.id) === messageId
  ));
  if (fromLastMessage) {
    return fromLastMessage.id;
  }

  const { byChatId } = global.messages;
  return Object.keys(byChatId).find((chatId) => {
    const chat = selectChat(global, chatId);
    return chat && isCommonBoxChat(chat) && byChatId[chat.id].byId[messageId];
  });
}

export function selectIsInSelectMode<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { selectedMessages } = selectTabState(global, tabId);

  return Boolean(selectedMessages);
}

export function selectIsMessageSelected<T extends GlobalState>(
  global: T, messageId: number,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageIds } = selectTabState(global, tabId).selectedMessages || {};
  if (!messageIds) {
    return false;
  }

  return messageIds.includes(messageId);
}

export function selectForwardedMessageIdsByGroupId<T extends GlobalState>(
  global: T, chatId: string, groupedId: string,
) {
  const chatMessages = selectChatMessages(global, chatId);
  if (!chatMessages) {
    return undefined;
  }

  return Object.values(chatMessages)
    .filter((message) => message.groupedId === groupedId && message.forwardInfo)
    .map(({ forwardInfo }) => forwardInfo!.fromMessageId);
}

export function selectMessageIdsByGroupId<T extends GlobalState>(global: T, chatId: string, groupedId: string) {
  const chatMessages = selectChatMessages(global, chatId);
  if (!chatMessages) {
    return undefined;
  }

  return Object.keys(chatMessages)
    .map(Number)
    .filter((id) => chatMessages[id].groupedId === groupedId);
}

// An album shows a single caption, which can belong to any of its items
export function selectAlbumMessageIdToEdit<T extends GlobalState>(global: T, message: ApiMessage) {
  const chatMessages = selectChatMessages(global, message.chatId);
  const albumIds = selectMessageIdsByGroupId(global, message.chatId, message.groupedId!)!;

  return albumIds.find((id) => chatMessages[id].content.text) ?? albumIds[0];
}

export function selectIsDocumentGroupSelected<T extends GlobalState>(
  global: T, chatId: string, groupedId: string,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageIds: selectedIds } = selectTabState(global, tabId).selectedMessages || {};
  if (!selectedIds) {
    return false;
  }

  const groupIds = selectMessageIdsByGroupId(global, chatId, groupedId);
  return groupIds && groupIds.every((id) => selectedIds.includes(id));
}

export function selectSelectedMessagesCount<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageIds } = selectTabState(global, tabId).selectedMessages || {};

  return messageIds ? messageIds.length : 0;
}

export function selectCanAutoLoadMedia<T extends GlobalState>(
  global: T, message: ApiMessage,
) {
  const chat = selectChat(global, message.chatId);
  if (!chat) {
    return undefined;
  }

  const sender = selectSender(global, message);

  const webPage = selectWebPageFromMessage(global, message);
  const isPhoto = Boolean(getMessagePhoto(message) || getWebPagePhoto(webPage));
  const isVideo = Boolean(getMessageVideo(message) || getWebPageVideo(webPage));
  const isFile = Boolean(getMessageAudio(message) || getMessageVoice(message) || getMessageDocument(message));

  const {
    canAutoLoadPhotoFromContacts,
    canAutoLoadPhotoInPrivateChats,
    canAutoLoadPhotoInGroups,
    canAutoLoadVideoFromContacts,
    canAutoLoadVideoInPrivateChats,
    canAutoLoadVideoInGroups,
    canAutoLoadFileFromContacts,
    canAutoLoadFileInPrivateChats,
    canAutoLoadFileInGroups,
  } = global.settings.byKey;

  if (isPhoto) {
    return canAutoLoadMedia({
      global,
      chat,
      sender,
      canAutoLoadMediaFromContacts: canAutoLoadPhotoFromContacts,
      canAutoLoadMediaInPrivateChats: canAutoLoadPhotoInPrivateChats,
      canAutoLoadMediaInGroups: canAutoLoadPhotoInGroups,
    });
  }

  if (isVideo) {
    return canAutoLoadMedia({
      global,
      chat,
      sender,
      canAutoLoadMediaFromContacts: canAutoLoadVideoFromContacts,
      canAutoLoadMediaInPrivateChats: canAutoLoadVideoInPrivateChats,
      canAutoLoadMediaInGroups: canAutoLoadVideoInGroups,
    });
  }

  if (isFile) {
    return canAutoLoadMedia({
      global,
      chat,
      sender,
      canAutoLoadMediaFromContacts: canAutoLoadFileFromContacts,
      canAutoLoadMediaInPrivateChats: canAutoLoadFileInPrivateChats,
      canAutoLoadMediaInGroups: canAutoLoadFileInGroups,
    });
  }

  return true;
}

function canAutoLoadMedia<T extends GlobalState>({
  global,
  chat,
  sender,
  canAutoLoadMediaFromContacts,
  canAutoLoadMediaInPrivateChats,
  canAutoLoadMediaInGroups,
}: {
  global: T;
  chat: ApiChat;
  canAutoLoadMediaFromContacts: boolean;
  canAutoLoadMediaInPrivateChats: boolean;
  canAutoLoadMediaInGroups: boolean;
  sender?: ApiPeer;
}) {
  const isMediaFromContact = Boolean(sender && (
    selectIsChatWithSelf(global, sender.id) || selectUser(global, sender.id)?.isContact
  ));

  return Boolean(
    (isMediaFromContact && canAutoLoadMediaFromContacts)
    || (!isMediaFromContact && canAutoLoadMediaInPrivateChats && isUserId(chat.id))
    || (canAutoLoadMediaInGroups && isChatGroup(chat)),
  );
}

export function selectIsMessageProtected<T extends GlobalState>(global: T, message?: ApiMessage) {
  return Boolean(message && (
    message.isProtected || selectIsChatProtected(global, message.chatId) || hasMessageTtl(message)
  ));
}

export function selectIsChatProtected<T extends GlobalState>(global: T, chatId: string) {
  const chat = selectChat(global, chatId);

  if (!chat) return false;

  if (chat.isProtected || (isUserId(chatId) && selectIsUserChatProtected(global, chatId))) {
    return true;
  }

  return false;
}

export function selectHasProtectedMessage<T extends GlobalState>(global: T, chatId: string, messageIds?: number[]) {
  if (selectIsChatProtected(global, chatId)) {
    return true;
  }

  if (!messageIds) {
    return false;
  }

  const messages = selectChatMessages(global, chatId);

  return messageIds.some((messageId) => messages[messageId]?.isProtected);
}

export function selectCanForwardMessages<T extends GlobalState>(global: T, chatId: string, messageIds?: number[]) {
  if (selectIsChatProtected(global, chatId)) {
    return false;
  }

  if (!messageIds) {
    return false;
  }

  return messageIds
    .map((id) => selectChatMessageOrEphemeral(global, chatId, id))
    .every((message) => message && selectCanForwardMessage(global, message));
}

export function selectHasIpRevealingMedia<T extends GlobalState>(global: T, chatId: string, messageIds: number[]) {
  const messages = selectChatMessages(global, chatId);

  return messageIds
    .map((id) => messages[id])
    .some((message) => {
      if (!message) return false;

      const document = getMessageDocument(message);
      if (!document) return false;

      const extension = getDocumentExtension(document);
      if (!extension) return false;

      return isIpRevealingMedia({ mimeType: document.mimeType, extension });
    });
}

export function selectDefaultReaction<T extends GlobalState>(global: T, chatId: string) {
  const isPrivate = isUserId(chatId);
  const defaultReaction = global.config?.defaultReaction;
  if (!defaultReaction) {
    return undefined;
  }

  if (isPrivate) {
    return defaultReaction;
  }

  const chat = selectChat(global, chatId);
  const chatFullInfo = selectChatFullInfo(global, chatId);
  if (chat && isUserRightBanned(chat, 'sendReactions')) {
    return undefined;
  }

  const chatReactions = chatFullInfo?.enabledReactions;
  if (!chatReactions || !canSendReaction(defaultReaction, chatReactions)) {
    return undefined;
  }

  return defaultReaction;
}

// Slow, not to be used in `withGlobal`
export function selectVisibleUsers<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { chatId, threadId } = selectCurrentMessageList(global, tabId) || {};
  if (!chatId || !threadId) {
    return undefined;
  }

  const messageIds = selectTabThreadParam(global, chatId, threadId, 'viewportIds', tabId);
  if (!messageIds) {
    return undefined;
  }

  return messageIds.map((messageId) => {
    const { senderId } = selectChatMessage(global, chatId, messageId) || {};
    return senderId ? selectUser(global, senderId) : undefined;
  }).filter(Boolean);
}

export function selectShouldSchedule<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return selectCurrentMessageList(global, tabId)?.type === 'scheduled';
}

export function selectCanSchedule<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  return true;
}

export function selectCanScheduleUntilOnline<T extends GlobalState>(global: T, id: string) {
  const isChatWithSelf = selectIsChatWithSelf(global, id);
  return Boolean(!isChatWithSelf && isUserId(id) && selectUserStatus(global, id)?.wasOnline);
}

export function selectForwardsContainVoiceMessages<T extends GlobalState>(
  global: T,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageIds, fromChatId } = selectTabState(global, tabId).forwardMessages;
  if (!messageIds) return false;
  return messageIds.some((messageId) => {
    const message = selectChatMessageOrEphemeral(global, fromChatId!, messageId);
    if (!message) return false;
    return Boolean(message.content.voice) || Boolean(message.content.video?.isRound);
  });
}

export function selectReplyCanBeSentToChat<T extends GlobalState>(
  global: T,
  toChatId: string,
  fromChatId: string,
  replyInfo: ApiInputMessageReplyInfo,
) {
  if (!replyInfo.replyToMsgId) return false;
  const fromRealChatId = replyInfo?.replyToPeerId ?? fromChatId;
  if (toChatId === fromRealChatId) return true;
  const chatMessages = selectChatMessages(global, fromRealChatId);
  const message = chatMessages[replyInfo.replyToMsgId];

  return !isExpiredMessage(message);
}
export function selectForwardsCanBeSentToChat<T extends GlobalState>(
  global: T,
  toChatId: string,
  ...[tabId = getCurrentTabId()]: TabArgs<T>
) {
  const { messageIds, storyId, fromChatId } = selectTabState(global, tabId).forwardMessages;
  const chat = selectChat(global, toChatId);
  if ((!messageIds && !storyId) || !chat) return false;

  if (storyId) {
    return true;
  }

  const isSavedMessages = toChatId ? selectIsChatWithSelf(global, toChatId) : undefined;
  const options = getAllowedAttachmentOptions(chat, isSavedMessages);
  return !messageIds!.some((messageId) => {
    const message = selectChatMessageOrEphemeral(global, fromChatId!, messageId);
    return !message || сheckMessageSendingDenied(message, options);
  });
}
function сheckMessageSendingDenied(message: ApiMessage, options: IAllowedAttachmentOptions) {
  const isVoice = message.content.voice;
  const isRoundVideo = message.content.video?.isRound;
  const isPhoto = message.content.photo;
  const isGif = message.content.video?.isGif;
  const isVideo = message.content.video && !isRoundVideo && !isGif;
  const isAudio = message.content.audio;
  const isDocument = message.content.document;
  const isSticker = message.content.sticker;
  const isPlainText = message.content.text
    && !isVoice && !isRoundVideo && !isSticker && !isDocument && !isAudio && !isVideo && !isPhoto && !isGif;

  return (isVoice && !options.canSendVoices)
    || (isRoundVideo && !options.canSendRoundVideos)
    || (isSticker && !options.canSendStickers)
    || (isDocument && !options.canSendDocuments)
    || (isAudio && !options.canSendAudios)
    || (isVideo && !options.canSendVideos)
    || (isPhoto && !options.canSendPhotos)
    || (isGif && !options.canSendGifs)
    || (isPlainText && !options.canSendPlainText);
}

export function selectMessageReplyInfo<T extends GlobalState>(
  global: T, chatId: string, threadId: ThreadId, additionalReplyInfo?: ApiInputDraftReplyInfo,
) {
  const chat = selectChat(global, chatId);
  if (!chat) return undefined;

  return prepareMessageReplyInfo(threadId, additionalReplyInfo);
}

export function selectReplyMessage<T extends GlobalState>(global: T, message: ApiMessage) {
  const { replyInfo } = message;
  if (!replyInfo || replyInfo.type === 'story' || !replyInfo.replyToMsgId) return undefined;
  if (replyInfo.type === 'ephemeral') {
    return selectEphemeralMessage(global, message.chatId, replyInfo.replyToMsgId);
  }

  return selectChatMessage(global, replyInfo.replyToPeerId || message.chatId, replyInfo.replyToMsgId);
}
