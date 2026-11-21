import type { ActionReturnType } from '../../types';

import { isChatChannel, selectTabBrowserState } from '../../helpers';
import { addActionHandler, setGlobal } from '../../index';
import {
  addBlockedUser,
  addChats,
  addStoriesForPeer,
  addUsers,
  removeBlockedUser,
  removePeerStory,
  replaceWebPage,
  updateFullWebPage,
  updateLastReadStoryForPeer,
  updatePeerStory,
  updatePeersWithStories,
  updatePoll,
  updateStealthMode,
} from '../../reducers';
import { updateThreadInfo } from '../../reducers/threads';
import {
  selectChat,
  selectPeerStories,
  selectPeerStory,
} from '../../selectors';

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  switch (update['@type']) {
    case 'updateEntities': {
      const {
        users, chats, threadInfos, polls, webPages,
      } = update;
      if (users) global = addUsers(global, users);
      if (chats) global = addChats(global, chats);
      if (threadInfos) {
        threadInfos.forEach((threadInfo) => {
          global = updateThreadInfo(global, threadInfo);
        });
      }
      if (polls) {
        polls.forEach((poll) => {
          global = updatePoll(global, poll.summary.id, poll);
        });
      }
      if (webPages) {
        webPages.forEach((webPage) => {
          if (webPage.webpageType === 'full') {
            global = updateFullWebPage(global, webPage.id, webPage);
          } else {
            global = replaceWebPage(global, webPage.id, webPage);
          }
        });
      }
      setGlobal(global);
      break;
    }

    case 'updatePeerBlocked':
      if (update.isBlocked) {
        return addBlockedUser(global, update.id);
      } else if (update.isBlockedFromStories) {
        return global; // Unsupported
      } else {
        return removeBlockedUser(global, update.id);
      }

    case 'updateResetContactList':
      global = {
        ...global,
        contactList: {
          userIds: [],
        },
      };
      setGlobal(global);
      break;

    case 'updateConfig':
      actions.loadConfig();
      break;

    case 'updateNewAuthorization': {
      // Load more info about this session
      actions.loadAuthorizations();
      break;
    }

    case 'updateFavoriteStickers':
      actions.loadFavoriteStickers();
      break;

    case 'updateRecentStickers':
      actions.loadRecentStickers();
      break;

    case 'updateRecentReactions':
      actions.loadRecentReactions();
      break;

    case 'updateRecentEmojiStatuses':
      actions.loadRecentEmojiStatuses();
      break;

    case 'updateSavedReactionTags':
      actions.loadSavedReactionTags();
      break;

    case 'updateMoveStickerSetToTop': {
      const oldOrder = update.isCustomEmoji ? global.customEmojis.added.setIds : global.stickers.added.setIds;
      if (!oldOrder?.some((id) => id === update.id)) return global;
      const newOrder = [update.id, ...oldOrder.filter((id) => id !== update.id)];
      actions.reorderStickerSets({ order: newOrder, isCustomEmoji: update.isCustomEmoji });
      break;
    }

    case 'updateStickerSets':
      actions.loadStickerSets();
      break;

    case 'updateStickerSetsOrder': {
      // Filter out invalid set IDs, which may be sent by the server
      const order = update.order.filter((setId) => Boolean(global.stickers.setsById[setId]));

      actions.reorderStickerSets({ order, isCustomEmoji: update.isCustomEmoji });
      break;
    }

    case 'updateSavedGifs':
      actions.loadSavedGifs();
      break;

    case 'updatePrivacy':
      global = {
        ...global,
        settings: {
          ...global.settings,
          privacy: {
            ...global.settings.privacy,
            [update.key]: update.rules,
          },
        },
      };
      setGlobal(global);
      break;

    case 'updateWebViewResultSent':
      Object.values(global.byTabId).forEach((tabState) => {
        Object.entries(selectTabBrowserState(tabState).openedTabs).forEach(([tabKey, browserTab]) => {
          if (browserTab.type === 'webApp' && browserTab.webApp.queryId === update.queryId) {
            const { peerId, threadId } = browserTab.webApp;
            if (peerId && threadId !== undefined) actions.resetDraftReplyInfo({ chatId: peerId, threadId });
            actions.closeBrowserTab({ key: tabKey, skipClosingConfirmation: true, tabId: tabState.id });
          }
        });
      });
      break;

    case 'updateJoinChatWebViewDecision': {
      const { peerId, queryId, result } = update;
      const chat = selectChat(global, peerId);

      Object.values(global.byTabId).forEach((tabState) => {
        const tabId = tabState.id;
        Object.entries(selectTabBrowserState(tabState).openedTabs).forEach(([webAppKey, browserTab]) => {
          if (browserTab.type !== 'webApp') return;
          const { webApp } = browserTab;
          if (webApp.queryId !== queryId) return;

          const isChannel = webApp.isJoinChatBroadcast ?? Boolean(chat && isChatChannel(chat));

          if (result.type === 'webView') {
            const { botId, peerId: webAppPeerId, isJoinChatBroadcast } = webApp;
            actions.closeBrowserTab({ key: webAppKey, skipClosingConfirmation: true, tabId });
            actions.openChatInviteWebView({
              botId,
              url: result.url,
              queryId,
              peerId: webAppPeerId || peerId,
              isBroadcast: isJoinChatBroadcast ?? isChannel,
              tabId,
            });
            return;
          }

          actions.closeBrowserTab({ key: webAppKey, skipClosingConfirmation: true, tabId });

          if (result.type === 'approved') {
            actions.openChat({ id: peerId, tabId });
            actions.showNotification({
              message: { key: isChannel ? 'ActionChannelJoinedByRequestChannelYou' : 'ActionJoinedByRequestYou' },
              tabId,
            });
          } else if (result.type === 'declined') {
            actions.showNotification({
              message: { key: isChannel ? 'RequestToJoinChannelDeclined' : 'RequestToJoinGroupDeclined' },
              tabId,
            });
          } else if (result.type === 'queued') {
            actions.showNotification({
              message: { key: isChannel ? 'RequestToJoinChannelSentDescription' : 'RequestToJoinGroupSentDescription' },
              tabId,
            });
          }
        });
      });
      break;
    }

    case 'updateWebPage': {
      const { webPage } = update;
      if (webPage.webpageType === 'full') {
        global = updateFullWebPage(global, webPage.id, webPage);
      } else {
        global = replaceWebPage(global, webPage.id, webPage);
      }
      setGlobal(global);
      break;
    }

    case 'updateStory':
      global = addStoriesForPeer(global, update.peerId, { [update.story.id]: update.story });
      global = updatePeersWithStories(global, { [update.peerId]: selectPeerStories(global, update.peerId)! });
      setGlobal(global);
      break;

    case 'deleteStory':
      global = removePeerStory(global, update.peerId, update.storyId);
      setGlobal(global);
      break;

    case 'updateReadStories':
      global = updateLastReadStoryForPeer(global, update.peerId, update.lastReadId);
      setGlobal(global);
      break;

    case 'updateSentStoryReaction': {
      const { peerId, storyId, reaction } = update;
      const story = selectPeerStory(global, peerId, storyId);
      if (!story) return global;
      global = updatePeerStory(global, peerId, storyId, { sentReaction: reaction });
      setGlobal(global);
      break;
    }

    case 'updateStealthMode':
      global = updateStealthMode(global, update.stealthMode);
      setGlobal(global);
      break;

    case 'updateAttachMenuBots':
      actions.loadAttachBots();
      break;

    case 'updatePremiumFloodWait': {
      actions.processPremiumFloodWait({
        isUpload: update.isUpload,
      });
      break;
    }
  }

  return undefined;
});
