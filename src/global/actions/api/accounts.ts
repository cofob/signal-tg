import type { ApiAudio } from '../../../api/types';
import type { RequiredGlobalActions } from '../../index';
import type { GlobalState } from '../../types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { unique } from '../../../util/iteratees';
import { callApi } from '../../../api';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { updateUserFullInfo, updateUserSavedMusic } from '../../reducers';
import { appendShufflePlaylist, removeTrackFromShuffle } from '../../reducers/audioPlayer';
import { selectTabState, selectUserFullInfo, selectUserSavedMusic,
} from '../../selectors';
import {
  selectIsPlaylistFullyLoaded, selectPlaybackSource, selectPlaylistKeys,
} from '../../selectors/audioPlayer';

addActionHandler('loadSavedMusicIds', async (global): Promise<void> => {
  if (global.users.savedMusicById || global.users.isSavedMusicLoading) return;

  global = updateSavedMusicState(global, undefined, true);
  setGlobal(global);

  const savedMusicIds = await callApi('fetchSavedMusicIds');
  const savedMusicById: Record<string, true> = {};
  savedMusicIds?.forEach((id: string) => {
    savedMusicById[id] = true;
  });

  global = getGlobal();
  global = updateSavedMusicState(global, savedMusicById, false);
  setGlobal(global);
});

addActionHandler('toggleMusicInProfile', async (global, actions, payload): Promise<void> => {
  const { audio, tabId = getCurrentTabId() } = payload;
  const { savedMusicById } = global.users;
  if (!savedMusicById || global.users.isSavedMusicLoading) return;

  const shouldRemove = Boolean(savedMusicById[audio.id]);

  global = updateSavedMusicState(global, savedMusicById, true);
  setGlobal(global);

  const result = await callApi('saveMusic', { audio, shouldRemove: shouldRemove || undefined });

  global = getGlobal();
  if (!result) {
    global = updateSavedMusicState(global, global.users.savedMusicById, false);
    setGlobal(global);
    actions.showNotification({ message: { key: 'GeneralError' }, tabId });
    return;
  }

  const updatedSavedMusicById = { ...global.users.savedMusicById };
  if (shouldRemove) {
    delete updatedSavedMusicById[audio.id];
  } else {
    updatedSavedMusicById[audio.id] = true;
  }

  global = updateSavedMusicState(global, updatedSavedMusicById, false);
  global = updateOwnProfileMusic(global, actions, audio, shouldRemove);

  const tabIdsToClosePlayer: number[] = [];
  Object.values(global.byTabId).forEach(({ id: otherTabId }) => {
    const source = selectPlaybackSource(global, otherTabId);
    if (source?.type !== 'savedMusic' || source.peerId !== global.currentUserId) return;

    if (shouldRemove) {
      global = removeTrackFromShuffle(global, audio.id, otherTabId);
      const { activeItem } = selectTabState(global, otherTabId).audioPlayer;
      if (activeItem?.type === 'savedMusic' && activeItem.audioId === audio.id) {
        tabIdsToClosePlayer.push(otherTabId);
      }
      return;
    }

    if (selectPlaylistKeys(global, otherTabId)?.includes(audio.id)) {
      global = appendShufflePlaylist(global, [audio.id], selectIsPlaylistFullyLoaded(global, otherTabId), otherTabId);
    }
  });

  setGlobal(global);
  tabIdsToClosePlayer.forEach((otherTabId) => actions.closeAudioPlayer({ tabId: otherTabId }));
  actions.showNotification({
    message: { key: shouldRemove ? 'AudioSaveToMyProfileUnsaved' : 'AudioSaveToMyProfileSaved' },
    tabId,
  });
});

let savedMusicReorderQueue: Promise<unknown> = Promise.resolve();
let savedMusicReorderGeneration = 0;

addActionHandler('reorderSavedMusic', async (global, actions, payload): Promise<void> => {
  const { audioId, afterAudioId, tabId = getCurrentTabId() } = payload;

  const { currentUserId } = global;
  if (!currentUserId) return;

  const savedMusic = selectUserSavedMusic(global, currentUserId);
  const audio = savedMusic?.byId[audioId];
  if (!savedMusic || !audio || audioId === afterAudioId) return;

  const ids = savedMusic.ids.filter((id) => id !== audioId);
  const afterIndex = afterAudioId ? ids.indexOf(afterAudioId) : -1;
  ids.splice(afterIndex + 1, 0, audioId);

  global = applySavedMusicOrder(global, currentUserId, ids);
  setGlobal(global);

  const generation = savedMusicReorderGeneration;
  const request = savedMusicReorderQueue.then(() => (
    generation === savedMusicReorderGeneration
      ? callApi('saveMusic', {
        audio,
        afterAudio: afterAudioId ? savedMusic.byId[afterAudioId] : undefined,
      })
      : undefined
  ));
  savedMusicReorderQueue = request.catch(() => undefined);

  const result = await request;
  if (result) return;
  if (generation !== savedMusicReorderGeneration) return;

  savedMusicReorderGeneration += 1;

  global = getGlobal();
  const latestSavedMusic = selectUserSavedMusic(global, currentUserId);
  if (latestSavedMusic) {
    global = updateUserSavedMusic(global, currentUserId, {
      ...latestSavedMusic,
      ids: [],
      isFullyLoaded: false,
    });
  }
  setGlobal(global);

  actions.loadSavedMusic({ userId: currentUserId, tabId });
  actions.loadFullUser({ userId: currentUserId });
  actions.showNotification({ message: { key: 'GeneralError' }, tabId });
});

addActionHandler('loadAccountDaysTtl', async (global, actions, payload): Promise<void> => {
  const result = await callApi('fetchAccountTTL');
  if (!result) return;

  global = getGlobal();
  global = {
    ...global,
    settings: {
      ...global.settings,
      accountDaysTtl: result.days,
    },
  };
  setGlobal(global);
});

addActionHandler('setAccountTTL', async (global, actions, payload): Promise<void> => {
  const { days, tabId = getCurrentTabId() } = payload || {};
  if (!days) return;

  const result = await callApi('setAccountTTL', { days });
  if (!result) return;

  global = getGlobal();
  global = {
    ...global,
    settings: {
      ...global.settings,
      accountDaysTtl: days,
    },
  };
  setGlobal(global);
  actions.closeDeleteAccountModal({ tabId });
});

// Keeps the current user's own profile playlist in step with the toggle, so it does not need a refetch
function applySavedMusicOrder<T extends GlobalState>(global: T, userId: string, ids: string[]): T {
  const savedMusic = selectUserSavedMusic(global, userId);
  if (!savedMusic) return global;

  global = updateUserSavedMusic(global, userId, { ...savedMusic, ids });

  const firstAudio = savedMusic.byId[ids[0]];
  if (firstAudio && selectUserFullInfo(global, userId)) {
    global = updateUserFullInfo(global, userId, { savedMusic: firstAudio });
  }

  return global;
}

function updateOwnProfileMusic<T extends GlobalState>(
  global: T, actions: RequiredGlobalActions, audio: ApiAudio, shouldRemove?: boolean,
): T {
  const { currentUserId } = global;
  if (!currentUserId || !selectUserFullInfo(global, currentUserId)) return global;

  const savedMusic = selectUserSavedMusic(global, currentUserId);
  if (savedMusic) {
    const byId = { ...savedMusic.byId, [audio.id]: audio };
    let ids: string[];
    if (shouldRemove) {
      delete byId[audio.id];
      ids = savedMusic.ids.filter((id) => id !== audio.id);
    } else {
      ids = unique([audio.id, ...savedMusic.ids]);
    }

    global = updateUserSavedMusic(global, currentUserId, {
      ...savedMusic,
      byId,
      ids,
      count: Math.max(shouldRemove ? savedMusic.count - 1 : savedMusic.count + 1, ids.length),
    });
  }

  if (!shouldRemove) {
    // Newly saved music is put on top of the playlist
    return updateUserFullInfo(global, currentUserId, { savedMusic: audio });
  }

  const remainingMusic = selectUserSavedMusic(global, currentUserId);
  if (!remainingMusic || (!remainingMusic.ids.length && !remainingMusic.isFullyLoaded)) {
    if (selectUserFullInfo(global, currentUserId)?.savedMusic?.id === audio.id) {
      actions.loadFullUser({ userId: currentUserId });
      return updateUserFullInfo(global, currentUserId, { savedMusic: undefined });
    }
    return global;
  }

  return updateUserFullInfo(global, currentUserId, {
    savedMusic: remainingMusic.ids.length
      ? remainingMusic.byId[remainingMusic.ids[0]]
      : undefined,
  });
}

function updateSavedMusicState<T extends GlobalState>(
  global: T,
  savedMusicById: Record<string, true> | undefined,
  isSavedMusicLoading: boolean,
): T {
  return {
    ...global,
    users: {
      ...global.users,
      savedMusicById,
      isSavedMusicLoading,
    },
  };
}
