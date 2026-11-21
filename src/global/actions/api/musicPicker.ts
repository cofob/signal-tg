import type { ApiMessage } from '../../../api/types';

import { GLOBAL_SEARCH_SLICE } from '../../../config';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { getSearchResultKey } from '../../../util/keys/searchResultKey';
import { callApi } from '../../../api';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import {
  addMessages, addUserStatuses, updateMusicPicker,
} from '../../reducers';
import {
  selectChat, selectMusicPicker, selectPeer,
} from '../../selectors';

let requestGeneration = 0;

addActionHandler('loadMusicPickerShared', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};
  const musicPicker = selectMusicPicker(global, tabId);
  if (!musicPicker) return;

  let shared = musicPicker.shared;
  if (!shared) {
    shared = { generation: getNextGeneration(), ids: [] };
    global = updateMusicPicker(global, { shared }, tabId);
    setGlobal(global);
    global = getGlobal();
  }

  if (shared.isLoading || shared.isFullyLoaded) return;

  const { generation } = shared;
  global = updateMusicPicker(global, { shared: { ...shared, isLoading: true } }, tabId);
  setGlobal(global);
  global = getGlobal();

  const offsetPeer = shared.nextOffsetPeerId ? selectPeer(global, shared.nextOffsetPeerId) : undefined;
  const result = await callApi('searchMessagesGlobal', {
    query: '',
    type: 'audio',
    limit: GLOBAL_SEARCH_SLICE,
    offsetRate: shared.nextOffsetRate,
    offsetId: shared.nextOffsetId,
    offsetPeer,
  });

  global = getGlobal();
  const currentShared = selectMusicPicker(global, tabId)?.shared;
  if (!currentShared || currentShared.generation !== generation) return;

  if (!result) {
    global = updateMusicPicker(global, { shared: { ...currentShared, isLoading: false } }, tabId);
    setGlobal(global);
    return;
  }

  const {
    userStatusesById, totalCount, nextOffsetRate, nextOffsetId, nextOffsetPeerId,
  } = result;
  const messages: ApiMessage[] = result.messages;

  global = addMessages(global, messages);
  global = addUserStatuses(global, userStatusesById);

  const newIds = messages
    .filter((message) => !message.isProtected && !selectChat(global, message.chatId)?.isProtected)
    .map(getSearchResultKey)
    .filter((id) => !currentShared.ids.includes(id));
  const loadedCount = (currentShared.loadedCount || 0) + messages.length;

  global = updateMusicPicker(global, {
    shared: {
      generation,
      ids: [...currentShared.ids, ...newIds],
      loadedCount,
      totalCount,
      nextOffsetRate,
      nextOffsetId,
      nextOffsetPeerId,
      isLoading: false,
      isFullyLoaded: !messages.length || loadedCount >= totalCount,
    },
  }, tabId);
  setGlobal(global);
});

function getNextGeneration() {
  requestGeneration += 1;
  return requestGeneration;
}
