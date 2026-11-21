import type { ApiSessionData } from '../api/types';
import type { SharedSessionData } from '../types';

import { SESSION_ACCOUNT_PREFIX } from '../config';
import {
  isEncryptedSessionStoreEnabled,
  isSessionStoreLocked,
  removeSessionValue,
  writeSessionValue,
} from './passcode/sessionStore';
import {
  ACCOUNT_SLOT, getAccountSlots, loadSlotSession, storeAccountData, updateSessionStorage,
} from './multiaccount';
import { lockPasscodeSessionStore } from './passcode';

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
