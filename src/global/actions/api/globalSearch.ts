import type { ApiGlobalMessageSearchType, ApiMessage, ApiMessageSearchContext, ApiPeer,
  ApiUserStatus,
} from '../../../api/types';
import type { ActionReturnType, GlobalState, TabArgs } from '../../types';

import { GLOBAL_SEARCH_SLICE } from '../../../config';
import { timestampPlusDay } from '../../../util/dates/dateMath';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { throttle } from '../../../util/schedulers';
import { callApi } from '../../../api';
import { addActionHandler, getActions, getGlobal, setGlobal } from '../..';
import {
  addMessages,
  addUserStatuses,
  updateGlobalSearch,
  updateGlobalSearchFetchingStatus,
  updateGlobalSearchResults,
} from '../../reducers';
import { selectCurrentGlobalSearchQuery, selectPeer, selectTabState,
} from '../../selectors';
import { selectPlaybackSource } from '../../selectors/audioPlayer';

const searchThrottled = throttle((cb) => cb(), 500, false);

addActionHandler('setGlobalSearchQuery', (global, actions, payload): ActionReturnType => {
  const { query, tabId = getCurrentTabId() } = payload;
  const { chatId } = selectTabState(global, tabId).globalSearch;

  if (query && !chatId) {
    void searchThrottled(async () => {
      const searchResult = await callApi('searchChats', { query });

      global = getGlobal();
      const currentSearchQuery = selectCurrentGlobalSearchQuery(global, tabId);
      if (!searchResult || !currentSearchQuery || (query !== currentSearchQuery)) {
        global = updateGlobalSearchFetchingStatus(global, { chats: false }, tabId);
        setGlobal(global);
        return;
      }

      const {
        accountResultIds, globalResultIds,
      } = searchResult;

      global = updateGlobalSearchFetchingStatus(global, { chats: false }, tabId);
      global = updateGlobalSearch(global, {
        localResults: {
          peerIds: accountResultIds,
        },
        globalResults: {
          ...selectTabState(global, tabId).globalSearch.globalResults,
          peerIds: globalResultIds,
        },
      }, tabId);

      setGlobal(global);
    });
  }
});

addActionHandler('setGlobalSearchDate', (global, actions, payload): ActionReturnType => {
  const { date, tabId = getCurrentTabId() } = payload;
  const maxDate = date ? timestampPlusDay(date) : date;

  global = updateGlobalSearch(global, {
    minDate: date,
    maxDate,
    query: '',
    resultsByType: {
      ...selectTabState(global, tabId).globalSearch.resultsByType,
      text: {
        totalCount: undefined,
        foundIds: [],
        nextOffsetId: 0,
      },
    },
  }, tabId);
  setGlobal(global);

  actions.searchMessagesGlobal({ type: 'text', tabId });
});

addActionHandler('searchMessagesGlobal', (global, actions, payload): ActionReturnType => {
  const {
    type, context, shouldResetResultsByType, shouldCheckFetchingMessagesStatus, tabId = getCurrentTabId(),
  } = payload;

  if (shouldCheckFetchingMessagesStatus) {
    global = updateGlobalSearchFetchingStatus(global, { messages: true }, tabId);
    setGlobal(global);
    global = getGlobal();
  }

  const {
    query, resultsByType, chatId,
  } = selectTabState(global, tabId).globalSearch;
  const {
    totalCount, foundIds, nextOffsetId, nextOffsetPeerId, nextOffsetRate,
  } = (!shouldResetResultsByType && resultsByType?.[type]) || {};

  // Stop loading if we have all the messages or server returned 0
  if (totalCount !== undefined && (!totalCount || (foundIds && foundIds.length >= totalCount))) {
    return;
  }

  const chat = chatId ? selectPeer(global, chatId) : undefined;
  const offsetPeer = nextOffsetPeerId ? selectPeer(global, nextOffsetPeerId) : undefined;

  searchMessagesGlobal(global, {
    query,
    type,
    context,
    shouldResetResultsByType,
    offsetRate: nextOffsetRate,
    offsetId: nextOffsetId,
    offsetPeer,
    peer: chat,
    tabId,
  });
});

async function searchMessagesGlobal<T extends GlobalState>(global: T, params: {
  query?: string;
  type: ApiGlobalMessageSearchType;
  context?: ApiMessageSearchContext;
  offsetRate?: number;
  offsetId?: number;
  offsetPeer?: ApiPeer;
  peer?: ApiPeer;
  maxDate?: number;
  minDate?: number;
  tabId: TabArgs<T>[0];
  shouldResetResultsByType?: boolean;
}) {
  const {
    query = '', type, context, offsetRate, offsetId, offsetPeer,
    peer, maxDate, minDate, shouldResetResultsByType, tabId = getCurrentTabId(),
  } = params;

  let result: {
    messages: ApiMessage[];
    userStatusesById?: Record<number, ApiUserStatus>;
    totalCount: number;
    nextOffsetRate?: number;
    nextOffsetId?: number;
    nextOffsetPeerId?: string;
  } | undefined;

  if (peer) {
    const inChatResult = await callApi('searchMessagesInChat', {
      peer,
      query,
      type,
      limit: GLOBAL_SEARCH_SLICE,
      offsetId,
      minDate,
      maxDate,
    });

    if (inChatResult) {
      const { messages, totalCount, nextOffsetId } = inChatResult;

      result = {
        messages,
        totalCount,
        nextOffsetId,
      };
    }
  } else {
    result = await callApi('searchMessagesGlobal', {
      query,
      offsetRate,
      offsetId,
      offsetPeer,
      limit: GLOBAL_SEARCH_SLICE,
      type,
      context,
      maxDate,
      minDate,
    });
  }

  global = getGlobal();

  if (shouldResetResultsByType) {
    global = updateGlobalSearch(global, {
      resultsByType: {
        ...(selectTabState(global, tabId).globalSearch || {}).resultsByType,
        [type]: undefined,
      },
    }, tabId);
  }
  const currentSearchQuery = selectCurrentGlobalSearchQuery(global, tabId);
  if (!result || (query !== '' && query !== currentSearchQuery)) {
    global = updateGlobalSearchFetchingStatus(global, { messages: false }, tabId);
    setGlobal(global);
    settlePlayerStepForGlobalSearch(type, tabId, false);
    return;
  }

  const {
    messages, userStatusesById, totalCount, nextOffsetRate, nextOffsetId, nextOffsetPeerId,
  } = result;

  if (userStatusesById) {
    global = addUserStatuses(global, userStatusesById);
  }

  if (messages.length) {
    global = addMessages(global, messages);
  }

  global = updateGlobalSearchResults(
    global,
    messages,
    totalCount,
    type,
    nextOffsetRate,
    nextOffsetId,
    nextOffsetPeerId,
    tabId,
  );

  setGlobal(global);

  global = getGlobal();
  if (global.audioPlayer.orderMode === 'shuffle' && selectPlaybackSource(global, tabId)?.type === 'globalSearch') {
    getActions().loadShufflePlaylist({ tabId });
  }
  settlePlayerStepForGlobalSearch(type, tabId, true);
}

function settlePlayerStepForGlobalSearch(type: ApiGlobalMessageSearchType, tabId: number, shouldContinue: boolean) {
  const global = getGlobal();
  const source = selectPlaybackSource(global, tabId);
  if (source?.type !== 'globalSearch' || source.mediaType !== type) return;

  getActions().settlePendingPlaylistStep({ shouldContinue, tabId });
}
