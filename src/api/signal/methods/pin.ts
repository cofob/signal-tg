import type { ApiSignalPinSettings } from '../../types';

import { SIGNAL_PRIMARY_DEVICE_ID } from '../../../lib/signal/config';
import { removeAccountPin, setAccountPin, setRegistrationLock } from '../../../lib/signal/svr/accountPin';
import { client, logError, processor, store } from '../engine';

// Settings of a primary device registered here: the Signal PIN, Registration Lock and contact discovery. Linked
// devices have none of them

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

/** Whether storage service contacts with only a number are looked up; `undefined` on linked devices */
export async function fetchSignalContactDiscovery() {
  const account = await store.getItem('account');
  return account?.deviceId === SIGNAL_PRIMARY_DEVICE_ID ? Boolean(account.isContactDiscoveryEnabled) : undefined;
}

/** Turning contact discovery on looks up the stored contacts right away; resolves with the new value */
export async function setSignalContactDiscovery(isEnabled: boolean) {
  if (await fetchSignalContactDiscovery() === undefined) return undefined;
  try {
    await client.updateAccount({ isContactDiscoveryEnabled: isEnabled || undefined });
  } catch (err) {
    logError(err);
    return undefined;
  }
  if (isEnabled) processor.discoverStorageContacts().catch(logError);
  return isEnabled;
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
