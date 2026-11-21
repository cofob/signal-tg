import type { ApiSignalPinSettings } from '../../types';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../../../lib/signal/config';
import { removeAccountPin, setAccountPin, setRegistrationLock } from '../../../lib/signal/svr/accountPin';
import { client, logError, store } from '../engine';

// The Signal PIN and Registration Lock of a primary device registered here; linked devices have neither

/** `undefined` on linked devices, whose primary device manages the PIN */
export function fetchSignalPinSettings() {
  return getPinSettings();
}

/** Creates or changes the PIN; resolves with the new settings, or `undefined` when it failed */
export function setSignalPin(pin: string) {
  return runPinChange(() => setAccountPin(client, pin));
}

export function removeSignalPin() {
  return runPinChange(() => removeAccountPin(client));
}

export function setSignalRegistrationLock(isEnabled: boolean) {
  return runPinChange(() => setRegistrationLock(client, isEnabled));
}

async function runPinChange(change: () => Promise<unknown>) {
  if (!await getPinSettings()) return undefined;
  try {
    await change();
  } catch (err) {
    logError(err);
    return undefined;
  }
  return getPinSettings();
}

async function getPinSettings(): Promise<ApiSignalPinSettings | undefined> {
  const account = await store.getItem('account');
  if (account?.deviceId !== SIGNAL_PRIMARY_DEVICE_ID) return undefined;
  return {
    hasPin: Boolean(account.hasSvrPin),
    isRegistrationLockEnabled: Boolean(account.isRegistrationLockEnabled),
  };
}
