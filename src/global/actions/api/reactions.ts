import type { ActionReturnType } from '../../types';
import {
  type ApiAvailableReaction,
  ApiMediaFormat,
  type ApiMessage,
  type ApiSavedReactionTag,
} from '../../../api/types';

import { GENERAL_REFETCH_INTERVAL } from '../../../config';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import {
  buildCollectionByCallback, omit, omitUndefined,
} from '../../../util/iteratees';
import { getMessageKey } from '../../../util/keys/messageKey';
import * as mediaLoader from '../../../util/mediaLoader';
import requestActionTimeout from '../../../util/requestActionTimeout';
import { callApi } from '../../../api';
import { LIMITS } from '../../../limits';
import {
  getDocumentMediaHash,
  getReactionKey,
  getUserReactions,
  isChatAdmin,
  isMessageLocal,
  isSameReaction,
  isUserRightBanned,
} from '../../helpers';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import {
  replaceChatMessages,
  updateChatMessage,
} from '../../reducers';
import {
  addMessageReaction,
  pauseReactionPolling,
  removePeerReactions,
  subtractXForEmojiInteraction,
} from '../../reducers/reactions';
import { updateTabState } from '../../reducers/tabs';
import {
  selectChat,
  selectChatMessage,
  selectChatMessages,
  selectDefaultReaction,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectMessageIdsByGroupId,
  selectPeer,
  selectPerformanceSettingsValue,
  selectTabState,
} from '../../selectors';

const INTERACTION_RANDOM_OFFSET = 40;

let interactionLocalId = 0;

addActionHandler('loadAvailableReactions', async (global): Promise<void> => {
  const result = await callApi('fetchAvailableReactions');
  if (!result) {
    return;
  }

  // Preload animations
  result.forEach((availableReaction: ApiAvailableReaction) => {
    if (availableReaction.aroundAnimation) {
      mediaLoader.fetch(`sticker${availableReaction.aroundAnimation.id}`, ApiMediaFormat.BlobUrl);
    }
    if (availableReaction.centerIcon) {
      mediaLoader.fetch(`sticker${availableReaction.centerIcon.id}`, ApiMediaFormat.BlobUrl);
    }
    if (availableReaction.appearAnimation) {
      mediaLoader.fetch(`sticker${availableReaction.appearAnimation.id}`, ApiMediaFormat.BlobUrl);
    }
    if (availableReaction.selectAnimation) {
      mediaLoader.fetch(getDocumentMediaHash(availableReaction.selectAnimation, 'full')!, ApiMediaFormat.BlobUrl);
    }
  });

  global = getGlobal();
  global = {
    ...global,
    reactions: {
      ...global.reactions,
      availableReactions: result,
    },
  };
  setGlobal(global);

  requestActionTimeout({
    action: 'loadAvailableReactions',
    payload: undefined,
  }, GENERAL_REFETCH_INTERVAL);
});

addActionHandler('interactWithAnimatedEmoji', (global, actions, payload): ActionReturnType => {
  const {
    emoji, x, y, startSize, isReversed, tabId = getCurrentTabId(),
  } = payload;

  const activeEmojiInteraction = {
    id: interactionLocalId++,
    animatedEffect: emoji,
    x: subtractXForEmojiInteraction(global, x) + Math.random()
    * INTERACTION_RANDOM_OFFSET - INTERACTION_RANDOM_OFFSET / 2,
    y: y + Math.random() * INTERACTION_RANDOM_OFFSET - INTERACTION_RANDOM_OFFSET / 2,
    startSize,
    isReversed,
  };

  return updateTabState(global, {
    activeEmojiInteractions: [...(selectTabState(global, tabId).activeEmojiInteractions || []), activeEmojiInteraction],
  }, tabId);
});

addActionHandler('sendEmojiInteraction', (global, actions, payload): ActionReturnType => {
  const {
    messageId, chatId, emoji, interactions,
  } = payload;
  if (global.connectionState !== 'connectionStateReady') return;

  const chat = selectChat(global, chatId);

  if (!chat || !emoji || selectIsChatWithSelf(global, chatId)) {
    return;
  }

  void callApi('sendEmojiInteraction', {
    chat,
    messageId,
    emoticon: emoji,
    timestamps: interactions,
  });
});

addActionHandler('sendDefaultReaction', (global, actions, payload): ActionReturnType => {
  const {
    chatId, messageId, tabId = getCurrentTabId(),
  } = payload;
  const reaction = selectDefaultReaction(global, chatId);
  const message = selectChatMessage(global, chatId, messageId);

  if (!reaction || !message || isMessageLocal(message)) return;

  actions.toggleReaction({
    chatId,
    messageId,
    reaction,
    tabId,
  });
});

addActionHandler('toggleReaction', async (global, actions, payload): Promise<void> => {
  const {
    chatId,
    reaction,
    shouldAddToRecent,
    tabId = getCurrentTabId(),
  } = payload;
  let { messageId } = payload;

  const chat = selectChat(global, chatId);
  let message = selectChatMessage(global, chatId, messageId);

  if (!chat || !message) {
    return;
  }

  const canSendReactions = isChatAdmin(chat)
    || !isUserRightBanned(chat, 'sendReactions');

  if (!canSendReactions) {
    return;
  }

  const isInSaved = selectIsChatWithSelf(global, chatId);

  const isInDocumentGroup = Boolean(message.groupedId) && !message.isInAlbum;
  const documentGroupFirstMessageId = isInDocumentGroup
    ? selectMessageIdsByGroupId(global, chatId, message.groupedId!)![0]
    : undefined;
  message = isInDocumentGroup
    ? selectChatMessage(global, chatId, documentGroupFirstMessageId!) || message
    : message;
  messageId = message?.id || messageId;

  const userReactions = getUserReactions(message);
  const hasReaction = userReactions.some((userReaction) => isSameReaction(userReaction, reaction));

  const newUserReactions = hasReaction
    ? userReactions.filter((userReaction) => !isSameReaction(userReaction, reaction)) : [...userReactions, reaction];

  const limit = LIMITS.maxReactions;
  const trimmedReactions = newUserReactions.slice(-limit);
  const messageKey = getMessageKey(message);

  if (selectPerformanceSettingsValue(global, 'reactionEffects')) {
    if (hasReaction) {
      actions.stopActiveReaction({ containerId: messageKey, reaction, tabId });
    } else {
      actions.startActiveReaction({ containerId: messageKey, reaction, tabId });
    }
  }

  global = addMessageReaction(global, message, trimmedReactions);
  setGlobal(global);

  try {
    await callApi('sendReaction', {
      chat,
      messageId,
      reactions: trimmedReactions,
      shouldAddToRecent,
    });

    if (isInSaved) {
      actions.loadSavedReactionTags();
    }
  } catch (error) {
    global = getGlobal();
    global = addMessageReaction(global, message, userReactions);
    setGlobal(global);
  }
});

addActionHandler('startActiveReaction', (global, actions, payload): ActionReturnType => {
  const { containerId, reaction, tabId = getCurrentTabId() } = payload;
  const tabState = selectTabState(global, tabId);

  if (!selectPerformanceSettingsValue(global, 'reactionEffects')) return undefined;

  const currentActiveReactions = tabState.activeReactions[containerId] || [];
  if (currentActiveReactions.some((active) => isSameReaction(active, reaction))) {
    return undefined;
  }

  const newActiveReactions = currentActiveReactions.concat(reaction);

  return updateTabState(global, {
    activeReactions: {
      ...tabState.activeReactions,
      [containerId]: newActiveReactions,
    },
  }, tabId);
});

addActionHandler('stopActiveReaction', (global, actions, payload): ActionReturnType => {
  const { containerId, reaction, tabId = getCurrentTabId() } = payload;

  const tabState = selectTabState(global, tabId);

  const currentActiveReactions = tabState.activeReactions[containerId] || [];
  // Remove all reactions if reaction is not specified
  const newMessageActiveReactions = reaction
    ? currentActiveReactions.filter((active) => !isSameReaction(active, reaction)) : [];

  const newActiveReactions = newMessageActiveReactions.length ? {
    ...tabState.activeReactions,
    [containerId]: newMessageActiveReactions,
  } : omit(tabState.activeReactions, [containerId]);

  return updateTabState(global, {
    activeReactions: newActiveReactions,
  }, tabId);
});

addActionHandler('setDefaultReaction', async (global, actions, payload): Promise<void> => {
  const { reaction } = payload;

  const result = await callApi('setDefaultReaction', { reaction });
  if (!result) {
    return;
  }

  global = getGlobal();

  if (!global.config) {
    actions.loadConfig(); // Refetch new config, if it is somehow not loaded
    return;
  }

  global = {
    ...global,
    config: {
      ...global.config,
      defaultReaction: reaction,
    },
  };
  setGlobal(global);
});

addActionHandler('stopActiveEmojiInteraction', (global, actions, payload): ActionReturnType => {
  const { id, tabId = getCurrentTabId() } = payload;

  return updateTabState(global, {
    activeEmojiInteractions: selectTabState(global, tabId)
      .activeEmojiInteractions?.filter((active) => active.id !== id),
  }, tabId);
});

addActionHandler('loadReactors', async (global, actions, payload): Promise<void> => {
  if (selectIsCurrentUserFrozen(global)) return;

  const { chatId, messageId, reaction } = payload;
  const chat = selectChat(global, chatId);
  const message = selectChatMessage(global, chatId, messageId);
  if (!chat || !message) {
    return;
  }

  const offset = message.reactors?.nextOffset;
  const result = await callApi('fetchMessageReactionsList', {
    reaction,
    chat,
    messageId,
    offset,
  });

  if (!result) {
    return;
  }

  global = getGlobal();
  global = updateChatMessage(global, chatId, messageId, {
    reactors: result,
  });
  setGlobal(global);
});

addActionHandler('loadMessageReactions', (global, actions, payload): ActionReturnType => {
  if (selectIsCurrentUserFrozen(global)) return;

  const { ids, chatId } = payload;

  const chat = selectChat(global, chatId);

  if (!chat || global.connectionState !== 'connectionStateReady') {
    return;
  }

  callApi('fetchMessageReactions', { ids, chat });
});

addActionHandler('sendWatchingEmojiInteraction', (global, actions, payload): ActionReturnType => {
  const {
    chatId, emoticon, x, y, startSize, isReversed, id, tabId = getCurrentTabId(),
  } = payload;

  const chat = selectChat(global, chatId);

  const tabState = selectTabState(global, tabId);
  if (!chat || !tabState.activeEmojiInteractions?.some((interaction) => interaction.id === id)
    || selectIsChatWithSelf(global, chatId)) {
    return undefined;
  }

  if (global.connectionState === 'connectionStateReady') {
    callApi('sendWatchingEmojiInteraction', { chat, emoticon });
  }

  return updateTabState(global, {
    activeEmojiInteractions: tabState.activeEmojiInteractions.map((activeEmojiInteraction) => {
      if (activeEmojiInteraction.id === id) {
        return {
          ...activeEmojiInteraction,
          x: subtractXForEmojiInteraction(global, x),
          y,
          startSize,
          isReversed,
        };
      }
      return activeEmojiInteraction;
    }),
  }, tabId);
});

addActionHandler('animateUnreadReaction', (global, actions, payload): ActionReturnType => {
  const { chatId, messageIds, tabId = getCurrentTabId() } = payload;

  actions.markMessagesRead({ chatId, messageIds });

  if (!selectPerformanceSettingsValue(global, 'reactionEffects')) return undefined;

  global = getGlobal();

  messageIds.forEach((id) => {
    const message = selectChatMessage(global, chatId, id);
    if (!message) return;

    const { reaction, isOwn, isUnread } = message.reactions?.recentReactions?.[0] ?? {};
    if (reaction && isUnread && !isOwn) {
      const messageKey = getMessageKey(message);
      actions.startActiveReaction({ containerId: messageKey, reaction, tabId });
    }
  });

  return undefined;
});

addActionHandler('loadTopReactions', async (global): Promise<void> => {
  const result = await callApi('fetchTopReactions', {
    hash: global.reactions.hash.topReactions,
  });
  if (!result) {
    return;
  }

  global = getGlobal();
  global = {
    ...global,
    reactions: {
      ...global.reactions,
      topReactions: result.reactions,
      hash: {
        ...global.reactions.hash,
        topReactions: result.hash,
      },
    },
  };
  setGlobal(global);
});

addActionHandler('loadRecentReactions', async (global): Promise<void> => {
  const result = await callApi('fetchRecentReactions', {
    hash: global.reactions.hash.recentReactions,
  });
  if (!result) {
    return;
  }

  global = getGlobal();
  global = {
    ...global,
    reactions: {
      ...global.reactions,
      recentReactions: result.reactions,
      hash: {
        ...global.reactions.hash,
        recentReactions: result.hash,
      },
    },
  };
  setGlobal(global);
});

addActionHandler('clearRecentReactions', async (global): Promise<void> => {
  const result = await callApi('clearRecentReactions');
  if (!result) {
    return;
  }

  global = getGlobal();
  global = {
    ...global,
    reactions: {
      ...global.reactions,
      recentReactions: [],
    },
  };
  setGlobal(global);
});

addActionHandler('loadDefaultTagReactions', async (global): Promise<void> => {
  const result = await callApi('fetchDefaultTagReactions', {
    hash: global.reactions.hash.defaultTags,
  });
  if (!result) {
    return;
  }

  global = getGlobal();
  global = {
    ...global,
    reactions: {
      ...global.reactions,
      defaultTags: result.reactions,
      hash: {
        ...global.reactions.hash,
        defaultTags: result.hash,
      },
    },
  };
  setGlobal(global);
});

addActionHandler('loadSavedReactionTags', async (global): Promise<void> => {
  const { hash } = global.savedReactionTags || {};

  const result = await callApi('fetchSavedReactionTags', { hash });
  if (!result) {
    return;
  }

  global = getGlobal();

  const tagsByKey = buildCollectionByCallback(
    result.tags, (tag: ApiSavedReactionTag) => ([getReactionKey(tag.reaction), tag]),
  );

  global = {
    ...global,
    savedReactionTags: {
      hash: result.hash,
      byKey: tagsByKey,
    },
  };
  setGlobal(global);
});

addActionHandler('deleteParticipantReaction', async (global, actions, payload): Promise<void> => {
  const {
    chatId, messageId, peerId, notificationPluralValue, tabId = getCurrentTabId(),
  } = payload;
  const chat = selectChat(global, chatId);
  const peer = selectPeer(global, peerId);
  if (!chat || !peer) return;

  const result = await callApi('deleteParticipantReaction', { chat, messageId, peer });
  if (!result) return;

  global = getGlobal();
  global = pauseReactionPolling(global, chatId);
  const message = selectChatMessage(global, chatId, messageId);
  if (message) {
    const update = removePeerReactions(message, peerId);
    if (update) {
      global = updateChatMessage(global, chatId, messageId, update);
    }
  }
  setGlobal(global);

  if (notificationPluralValue !== undefined) {
    actions.showNotification({
      message: { key: 'ReactionDeleted', options: { pluralValue: notificationPluralValue } },
      tabId,
    });
  }
});

addActionHandler('deleteParticipantReactions', async (global, actions, payload): Promise<void> => {
  const {
    chatId, peerId, shouldUseNotificationPluralLang, tabId = getCurrentTabId(),
  } = payload;
  const chat = selectChat(global, chatId);
  const peer = selectPeer(global, peerId);
  if (!chat || !peer) return;

  const result = await callApi('deleteParticipantReactions', { chat, peer });
  if (!result) return;

  global = getGlobal();
  global = pauseReactionPolling(global, chatId);
  const byId = selectChatMessages(global, chatId);
  if (byId) {
    let newById: Record<number, ApiMessage> | undefined;
    Object.values(byId).forEach((message) => {
      const update = removePeerReactions(message, peerId);
      if (!update) return;
      if (!newById) newById = { ...byId };
      newById[message.id] = omitUndefined({ ...message, ...update });
    });
    if (newById) {
      global = replaceChatMessages(global, chatId, newById);
    }
  }
  setGlobal(global);

  actions.showNotification({
    message: { key: 'ReactionDeleted', options: { pluralValue: shouldUseNotificationPluralLang ? 2 : 1 } },
    tabId,
  });
});

addActionHandler('reportMessageReaction', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, peerId } = payload;
  const chat = selectChat(global, chatId);
  const peer = selectPeer(global, peerId);
  if (!chat || !peer) return;

  void callApi('reportMessageReaction', { chat, messageId, reactorPeer: peer });
});

addActionHandler('editSavedReactionTag', async (global, actions, payload): Promise<void> => {
  const { reaction, title } = payload;

  const result = await callApi('updateSavedReactionTag', { reaction, title });

  if (!result) {
    return;
  }

  global = getGlobal();
  const tagsByKey = global.savedReactionTags?.byKey;
  if (!tagsByKey) return;

  const key = getReactionKey(reaction);
  const tag = tagsByKey[key];

  const newTag = {
    ...tag,
    title,
  };

  global = {
    ...global,
    savedReactionTags: {
      ...global.savedReactionTags!,
      byKey: {
        ...tagsByKey,
        [key]: newTag,
      },
    },
  };
  setGlobal(global);
});
