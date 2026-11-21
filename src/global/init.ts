import type { ActionReturnType, GlobalState } from './types';

import { IS_MULTIACCOUNT_SUPPORTED } from '../util/browser/globalEnvironment';
import { isCacheApiSupported } from '../util/cacheApi';
import { getCurrentTabId } from '../util/establishMultitabRole';
import { initGlobal } from '../util/init';
import { cloneDeep } from '../util/iteratees';
import { isLocalMessageId } from '../util/keys/messageKey';
import { parseLocationHash } from '../util/routing';
import { updatePeerColors } from '../util/theme';
import { batchMessageStoreUpdates, updateMessageStore } from './reducers/messages';
import { initializeChatMediaSearchResults } from './reducers/middleSearch';
import { updateTabState } from './reducers/tabs';
import { replaceTabThreadParam, replaceThreadLocalStateParam } from './reducers/threads';
import { selectThreadLocalStateParam } from './selectors/threads';
import { initSharedState } from './shared/sharedStateConnector';
import { initCache } from './cache';
import {
  addActionHandler, getGlobal, setGlobal,
} from './index';
import { INITIAL_TAB_STATE } from './initialState';

initCache();

addActionHandler('initShared', async (prevGlobal, actions, payload): Promise<void> => {
  const { force } = payload || {};
  await initGlobal(force, prevGlobal);
});

addActionHandler('init', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId(), isMasterTab } = payload || {};

  const initialTabState = cloneDeep(INITIAL_TAB_STATE);
  initialTabState.id = tabId;
  initialTabState.audioPlayer.playbackRate = global.audioPlayer.lastPlaybackRate;
  initialTabState.audioPlayer.isPlaybackRateActive = global.audioPlayer.isLastPlaybackRateActive;
  initialTabState.mediaViewer.playbackRate = global.mediaViewer.lastPlaybackRate;
  if (global.lastIsChatInfoShown) {
    initialTabState.chatInfo = {
      isOpen: true,
    };
  }

  global = {
    ...global,
    byTabId: {
      ...global.byTabId,
      [tabId]: initialTabState,
    },
  };

  if (isMasterTab) {
    initialTabState.isMasterTab = true;
  }

  if (IS_MULTIACCOUNT_SUPPORTED && initialTabState.isMasterTab) {
    initSharedState(global.sharedState);
  }

  global = batchMessageStoreUpdates(global, (threadsGlobal) => {
    Object.keys(threadsGlobal.messages.byChatId).forEach((chatId) => {
      const threadsById = threadsGlobal.messages.byChatId[chatId].threadsById;
      Object.keys(threadsById).forEach((thread) => {
        const threadId = Number(thread);
        const lastViewportIds = selectThreadLocalStateParam(threadsGlobal, chatId, threadId, 'lastViewportIds');
        // Check if migration from previous version is faulty
        if (!lastViewportIds?.every((id) => (
          isLocalMessageId(id) || threadsGlobal.messages.byChatId[chatId]?.byId[id]
        ))) {
          threadsGlobal = replaceThreadLocalStateParam(threadsGlobal, chatId, threadId, 'lastViewportIds', undefined);
          return;
        }
        threadsGlobal = initializeChatMediaSearchResults(threadsGlobal, chatId, threadId, 'media', tabId);
        threadsGlobal = replaceTabThreadParam(
          threadsGlobal,
          chatId,
          threadId,
          'viewportIds',
          lastViewportIds,
          tabId,
        );
      });
    });

    // Temporary state fix
    Object.keys(threadsGlobal.messages.byChatId).forEach((chatId) => {
      const threadsById = threadsGlobal.messages.byChatId[chatId].threadsById;
      const fixedThreadsById = Object.keys(threadsById).reduce((acc, key) => {
        const t = threadsById[key];
        if (!t.localState?.lastViewportIds) {
          acc[key] = t;
          return acc;
        }

        acc[key] = {
          ...t,
          localState: {
            ...t.localState,
            listedIds: t.localState.lastViewportIds,
          },
        };
        return acc;
      }, {} as GlobalState['messages']['byChatId'][string]['threadsById']);

      threadsGlobal = updateMessageStore(threadsGlobal, chatId, { threadsById: fixedThreadsById });
    });

    return threadsGlobal;
  });

  const parsedMessageList = parseLocationHash(global.currentUserId);

  if (global.auth.state !== 'authorizationStateReady'
    && !global.passcode.hasPasscode && !global.passcode.isScreenLocked) {
    Object.values(global.byTabId).forEach(({ id: otherTabId }) => {
      if (otherTabId === tabId) return;
      global = updateTabState(global, {
        inactiveReason: 'auth',
      }, otherTabId);
    });
  }

  isCacheApiSupported().then((isSupported) => {
    global = getGlobal();
    global.isCacheApiSupported = isSupported;
    setGlobal(global);
  });

  if (global.peerColors) {
    updatePeerColors(global.peerColors.general);
  }

  return updateTabState(global, {
    messageLists: parsedMessageList ? [parsedMessageList] : initialTabState.messageLists,
  }, tabId);
});
