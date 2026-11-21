import type { ApiSessionData } from '../api/types';
import type { SharedSessionData } from '../types';

import { SESSION_ACCOUNT_PREFIX } from '../config';
import {
  getSessionValueKeys,
  isEncryptedSessionStoreEnabled,
  isSessionStoreLocked,
  removeSessionValue,
  writeSessionValue,
} from './passcode/sessionStore';
import {
  ACCOUNT_SLOT, getAccountSlots, loadSlotSession, storeAccountData, updateSessionStorage,
} from './multiaccount';
import { lockPasscodeSessionStore } from './passcode';

// Storage keys of the Telegram sessions that earlier versions kept next to the account slots
const LEGACY_DC_IDS = [1, 2, 3, 4, 5];
const LEGACY_SESSION_KEYS = [
  'user_auth',
  'dc',
  ...LEGACY_DC_IDS.flatMap((dcId) => [`dc${dcId}_auth_key`, `dc${dcId}_hash`, `dc${dcId}_server_salt`]),
];

export function hasStoredSession() {
  return checkSessionLocked() || Boolean(loadSlotSession(ACCOUNT_SLOT));
}

export function storeSession(sessionData: ApiSessionData) {
  return updateSessionStorage(() => {
    const newSlotData: SharedSessionData = {
      ...loadSlotSession(ACCOUNT_SLOT),
      ...sessionData,
    };

    writeSessionValue(`${SESSION_ACCOUNT_PREFIX}${ACCOUNT_SLOT || 1}`, JSON.stringify(newSlotData));
  });
}

// Does nothing while the sessions are locked; the keys are removed at the first start after unlocking
export function clearLegacySessionKeys() {
  const storedKeys = new Set(getSessionValueKeys());
  const keys = LEGACY_SESSION_KEYS.filter((key) => storedKeys.has(key));
  if (!keys.length) return undefined;

  return updateSessionStorage(() => {
    keys.forEach((key) => removeSessionValue(key));
  });
}

export function clearStoredSession(slot?: number) {
  return updateSessionStorage(() => {
    removeSessionValue(`${SESSION_ACCOUNT_PREFIX}${slot || 1}`);
  });
}

// Intentionally does not refresh the sessions vault: used when locking the screen,
// when the encrypted copy must keep the last good snapshot
export function clearAllStoredSessions() {
  if (isEncryptedSessionStoreEnabled()) {
    lockPasscodeSessionStore();
    return;
  }

  getAccountSlots().forEach((slot) => removeSessionValue(`${SESSION_ACCOUNT_PREFIX}${slot}`));
}

export function updateSessionUserId(currentUserId: string) {
  return storeAccountData(ACCOUNT_SLOT, { userId: currentUserId });
}

export function checkSessionLocked() {
  return isSessionStoreLocked();
}
