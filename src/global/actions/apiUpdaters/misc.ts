import type { ActionReturnType } from '../../types';

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
} from '../../reducers';
import { updateThreadInfo } from '../../reducers/threads';
import {
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

      setGlobal(global);
      break;
  }

  return undefined;
});
