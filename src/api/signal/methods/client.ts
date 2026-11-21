import {
  disableEncryptionAtRest, enableEncryptionAtRest, forgetStorageKey,
} from '../../../lib/signal/store/atRestMigration';
import { reconnectClient, stopClient } from '../client';
import { db, store } from '../engine';

/**
 * Logging out forgets the account and local messages; the phone keeps listing the device until it unlinks it.
 * `noLogOut` only closes the connections.
 */
export async function destroy(noLogOut = false) {
  await stopClient(!noLogOut);
  // The engine stops when the screen locks, and every start brings the key again
  await forgetStorageKey();
}

/** Encrypts the engine's stores with `key`, which the page keeps in the passcode vault; used when a passcode is set */
export function enableStorageEncryption(key: ArrayBuffer) {
  return enableEncryptionAtRest(key, store, db);
}

/** Decrypts the stores in place; the page calls it before it drops the passcode and with it the key */
export function disableStorageEncryption() {
  return disableEncryptionAtRest(store, db);
}

export function disconnect() {
  void stopClient(false).then(forgetStorageKey);
}

/** Replaces the chat connection at once, such as after the computer slept or the network changed */
export function reconnectNow() {
  reconnectClient();
}
