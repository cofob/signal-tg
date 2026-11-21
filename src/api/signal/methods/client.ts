import { unlinkDevice } from '../../../lib/signal/account/linkDevice';
import { SIGNAL_PRIMARY_DEVICE_ID } from '../../../lib/signal/config';
import {
  disableEncryptionAtRest, enableEncryptionAtRest, eraseUnreadableRecords, forgetStorageKey,
} from '../../../lib/signal/store/atRestMigration';
import { reconnectClient, stopClient } from '../client';
import { db, logError, store } from '../engine';

/**
 * Logging out forgets the account and local messages, and removes a linked device from the account, so that the
 * server stops queueing messages for it: the request goes out while the data is wiped, and its failure, such as with
 * no connection, changes nothing about the logout. `noLogOut` only closes the connections.
 */
export async function destroy(noLogOut = false) {
  const unlinking = noLogOut ? undefined : unlinkLinkedDevice();
  await stopClient(!noLogOut);
  // The engine stops when the screen locks, and every start brings the key again
  forgetStorageKey();
  await unlinking;
}

/** A linked device may remove only itself; the primary device and the demo account have nothing to remove */
async function unlinkLinkedDevice() {
  try {
    const account = await store.getItem('account');
    if (!account || account.isDemo || account.deviceId === SIGNAL_PRIMARY_DEVICE_ID) return;
    await unlinkDevice(account);
  } catch (err) {
    logError(err);
  }
}

/**
 * Encrypts the engine's stores with `key`, which the page keeps in the passcode vault; used when a passcode is set.
 * Resolves with `true` only when a count found nothing in the clear; the page treats anything else as a failure.
 */
export function enableStorageEncryption(key: ArrayBuffer) {
  return enableEncryptionAtRest(key, store, db);
}

/**
 * Decrypts the stores of every account slot in place; the page calls it before it drops the passcode and with it the
 * key. Resolves with `true` only when a count found no encrypted record left.
 */
export function disableStorageEncryption() {
  return disableEncryptionAtRest(store, db);
}

/** Deletes the records that the key does not open, when the user asks for it; resolves with their number */
export function eraseUnreadableStorageRecords() {
  return eraseUnreadableRecords(store, db);
}

export function disconnect() {
  void stopClient(false).then(forgetStorageKey);
}

/** Replaces the chat connection at once, such as after the computer slept or the network changed */
export function reconnectNow() {
  reconnectClient();
}
