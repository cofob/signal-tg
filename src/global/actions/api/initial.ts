import type { ActionReturnType } from '../../types';
import { ManagementProgress } from '../../../types';

import {
  IS_SCREEN_LOCKED_CACHE_KEY,
  MEDIA_CACHE_NAME,
  MEDIA_CACHE_NAME_AVATARS,
  MEDIA_PROGRESSIVE_CACHE_NAME,
} from '../../../config';
import clearSignalLocalData from '../../../lib/signal/clearLocalData';
import { updateAppBadge } from '../../../util/appBadge';
import { IS_TAURI } from '../../../util/browser/globalEnvironment';
import { MAIN_IDB_STORE } from '../../../util/browser/idb';
import { PLATFORM_ENV } from '../../../util/browser/windowEnvironment';
import * as cacheApi from '../../../util/cacheApi';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import {
  ACCOUNT_SLOT, getAccountsInfo, getAccountSlotUrl, getFirstLoggedInAccountSlot,
} from '../../../util/multiaccount';
import {
  clearPasscodeStore, removeGlobalsVaultForSlot, requestPasscodeStateLock,
} from '../../../util/passcode';
import { broadcastPasscodeReset } from '../../../util/passcode/channel';
import { unregisterPushAccount } from '../../../util/pushNotifications';
import { resetInitialLocationHash, resetLocationHash } from '../../../util/routing';
import { pause } from '../../../util/schedulers';
import {
  checkSessionLocked,
  clearAllStoredSessions,
  clearStoredSession,
  storeSession,
} from '../../../util/sessions';
import { forgetSavedFiles } from '../../../util/tauri/nativeFiles';
import { clearWallpaperBlobs } from '../../../util/wallpaper/storage';
import {
  callApi, callApiLocal, initApi, reconnectApi, setShouldEnableDebugLog,
} from '../../../api';
import { forceUpdateSharedStateCache, removeGlobalFromCache, removeSharedStateFromCache } from '../../cache';
import {
  addActionHandler, getGlobal, setGlobal,
} from '../../index';
import {
  updateManagementProgress, updateSharedSettings,
} from '../../reducers';
import { updateAuth } from '../../reducers/auth';
import { updateSharedState } from '../../reducers/sharedState';
import { selectTabState } from '../../selectors';
import { selectSharedSettings } from '../../selectors/sharedState';
import { destroySharedStatePort, resetSharedStatePort } from '../../shared/sharedStateConnector';

let resetStoragePromise: Promise<boolean> | undefined;

const API_DESTROY_TIMEOUT_MS = 3000;

addActionHandler('initApi', (global, actions): ActionReturnType => {
  if (global.passcode.isScreenLocked || checkSessionLocked()
    || !selectTabState(global, getCurrentTabId()).isMasterTab) return;

  const { shouldCollectDebugLogs, language, signalProxyUrl } = selectSharedSettings(global);

  void initApi(actions.apiUpdate, {
    userAgent: navigator.userAgent,
    platform: PLATFORM_ENV,
    langCode: language,
    signalProxyUrl,
  });

  void setShouldEnableDebugLog(Boolean(shouldCollectDebugLogs));
});

// Reconnecting moves the live connections, an open link code and new requests to the new tunnel
addActionHandler('setSignalProxyUrl', (global, actions, payload): ActionReturnType => {
  // Only the master tab runs the API; a change from another tab reaches it after a reload
  const isMasterTab = selectTabState(global, getCurrentTabId()).isMasterTab;

  global = updateSharedSettings(global, { signalProxyUrl: payload.url });
  // Changes to initial shared state are not shared, and a reload takes the shared copy, which would drop the URL
  global = updateSharedState(global, { isInitial: undefined });
  // The link screen shows a spinner until a new code arrives through the new tunnel
  if (isMasterTab) global = updateAuth(global, { qrCode: undefined });
  setGlobal(global);

  forceUpdateSharedStateCache();
  if (isMasterTab) void reconnectApi();
});

addActionHandler('setAuthPhoneNumber', (global, actions, payload): ActionReturnType => {
  const { phoneNumber } = payload;

  void callApi('provideAuthPhoneNumber', phoneNumber.replace(/[^\d]/g, ''));

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('setAuthCode', (global, actions, payload): ActionReturnType => {
  const { code } = payload;

  void callApi('provideAuthCode', code);

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('setAuthCaptcha', (global, actions, payload): ActionReturnType => {
  void callApi('provideAuthCaptcha', payload.captchaLink);

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('requestAuthCode', (global, actions, payload): ActionReturnType => {
  void callApi('requestAuthCode', payload.transport);

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('setAuthPassword', (global, actions, payload): ActionReturnType => {
  const { password } = payload;

  void callApi('provideAuthPassword', password);

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('uploadProfilePhoto', async (global, actions, payload): Promise<void> => {
  const {
    photo, isFallback,
    tabId = getCurrentTabId(),
  } = payload;

  global = updateManagementProgress(global, ManagementProgress.InProgress, tabId);
  setGlobal(global);

  const result = await callApi('uploadProfilePhoto', { photo, isFallback });
  if (!result) return;

  global = getGlobal();
  global = updateManagementProgress(global, ManagementProgress.Complete, tabId);
  setGlobal(global);

  const userId = global.currentUserId;
  if (!userId) return;

  actions.loadFullUser({ userId });
});

addActionHandler('signUp', (global, actions, payload): ActionReturnType => {
  const { firstName, lastName, isDiscoverableByPhoneNumber } = payload;

  void callApi('provideAuthRegistration', { firstName, lastName, isDiscoverableByPhoneNumber });

  return updateAuth(global, {
    isLoading: true,
    errorKey: undefined,
  });
});

addActionHandler('returnToAuthPhoneNumber', (global): ActionReturnType => {
  void callApi('restartAuth');

  return updateAuth(global, {
    errorKey: undefined,
  });
});

addActionHandler('goToAuthQrCode', (global): ActionReturnType => {
  void callApi('restartAuthWithQr');

  // The previous code belongs to a closed provisioning socket
  return updateAuth(global, {
    isLoadingQrCode: true,
    qrCode: undefined,
    errorKey: undefined,
  });
});

addActionHandler('saveSession', async (global, actions, payload): Promise<void> => {
  if (global.passcode.isScreenLocked) {
    return;
  }

  const { sessionData } = payload;
  if (sessionData) {
    await storeSession(sessionData);
  } else {
    await clearStoredSession();
  }
});

addActionHandler('signOut', async (global, actions, payload): Promise<void> => {
  if ('hangUp' in actions) actions.hangUp({ tabId: getCurrentTabId() });
  if ('leaveGroupCall' in actions) actions.leaveGroupCall({ tabId: getCurrentTabId() });

  try {
    resetInitialLocationHash();
    resetLocationHash();
    await unregisterPushAccount();
    await Promise.race([callApi('destroy'), pause(API_DESTROY_TIMEOUT_MS)]);
  } catch (err) {
    // Do nothing
  }

  // `destroy` does nothing while the engine is not started, which a logout then has to survive
  await clearSignalLocalData().catch(() => undefined);

  actions.reset();
  await resetStorage();

  const targetAccountSlot = getFirstLoggedInAccountSlot() || 1;
  if (targetAccountSlot !== (ACCOUNT_SLOT || 1)) {
    window.location.replace(getAccountSlotUrl(targetAccountSlot));
    return;
  }

  if (payload?.forceInitApi) {
    actions.initApi();
  }
});

addActionHandler('requestChannelDifference', (global, actions, payload): ActionReturnType => {
  const { chatId } = payload;

  void callApi('requestChannelDifference', chatId);
});

addActionHandler('reset', async (global, actions): Promise<void> => {
  void cacheApi.clear(MEDIA_CACHE_NAME);
  void cacheApi.clear(MEDIA_CACHE_NAME_AVATARS);
  void cacheApi.clear(MEDIA_PROGRESSIVE_CACHE_NAME);

  const hasAccounts = await resetStorage();
  await unregisterPushAccount().catch(() => undefined);
  if (hasAccounts) {
    destroySharedStatePort();
  } else {
    resetSharedStatePort();
  }

  if (!hasAccounts) {
    await clearPasscodeStore();
    localStorage.removeItem(IS_SCREEN_LOCKED_CACHE_KEY);
    await clearWallpaperBlobs();
    if (IS_TAURI) await forgetSavedFiles().catch(() => undefined);
  }

  updateAppBadge(0);

  if (hasAccounts) {
    return;
  }

  actions.initShared({ force: true });
  Object.values(global.byTabId).forEach(({ id: otherTabId, isMasterTab }) => {
    actions.init({ tabId: otherTabId, isMasterTab });
  });
});

function resetStorage() {
  if (resetStoragePromise) return resetStoragePromise;

  const clearSessionPromise = clearStoredSession(ACCOUNT_SLOT);
  const clearGlobalsVaultPromise = requestPasscodeStateLock(() => removeGlobalsVaultForSlot(ACCOUNT_SLOT));

  resetStoragePromise = Promise.all([
    clearSessionPromise,
    clearGlobalsVaultPromise,
    removeGlobalFromCache(),
  ]).then(async () => {
    const hasAccounts = Boolean(Object.values(getAccountsInfo()).length);
    if (!hasAccounts) await removeSharedStateFromCache();
    return hasAccounts;
  }).finally(() => {
    resetStoragePromise = undefined;
  });

  return resetStoragePromise;
}

addActionHandler('disconnect', (): ActionReturnType => {
  void callApiLocal('disconnect');
});

addActionHandler('destroyConnection', (): ActionReturnType => {
  void callApiLocal('destroy', true);
});

addActionHandler('loadNearestCountry', async (global): Promise<void> => {
  if (global.connectionState !== 'connectionStateReady') {
    return;
  }

  const authNearestCountry = await callApi('fetchNearestCountry');

  global = getGlobal();
  global = updateAuth(global, {
    nearestCountry: authNearestCountry,
  });
  setGlobal(global);
});

addActionHandler('signOutAllAccounts', async (): Promise<void> => {
  try {
    await Promise.race([unregisterPushAccount(true), pause(API_DESTROY_TIMEOUT_MS)]);
    await Promise.race([callApi('destroy'), pause(API_DESTROY_TIMEOUT_MS)]);
  } catch (err) {
    // Do nothing
  }

  // The lock screen logs out while the engine is not started, and `destroy` does nothing then
  await clearSignalLocalData().catch(() => undefined);

  clearAllStoredSessions();
  await clearPasscodeStore().catch(() => undefined);

  try {
    localStorage.clear();
    await MAIN_IDB_STORE.clear();
    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  } catch (err) {
    // Do nothing
  }

  if (IS_TAURI) await forgetSavedFiles().catch(() => undefined);

  broadcastPasscodeReset();
  window.location.reload();
});
