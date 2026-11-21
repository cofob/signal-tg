import type MessageDb from '../db/MessageDb';
import type SignalStore from './SignalStore';

import { convertCachedBlobs } from '../attachments/attachmentCache';
import {
  setAtRestKey, setAtRestWriting, StorageLockedError,
} from './atRest';

// One change at a time: enabling and disabling rewrite the same records
let queue: Promise<unknown> = Promise.resolve();

/**
 * Gives the engine the key of the stores and encrypts what is stored in the clear, in place. New records are
 * encrypted from the moment the key is set, so the rewrite only has the old ones to do, and an interrupted one
 * resumes at the next start. Without a passcode there is no key and nothing changes.
 */
export function enableEncryptionAtRest(rawKey: ArrayBuffer, store: SignalStore, db: MessageDb) {
  return runOne(async () => {
    await setAtRestKey(rawKey, true);
    const state = await store.getEncryptionState();
    if (state?.state === 'on' && state.isMigrated) return;

    await store.setEncryptionState({ state: 'on', isMigrated: false });
    // Operations that began before the key was set finish first, so none of them writes in the clear afterwards
    await store.runExclusive(() => Promise.resolve());
    await store.convertRecords('encrypt');
    await db.convertRecords('encrypt');
    await convertCachedBlobs('encrypt');
    await store.setEncryptionState({ state: 'on', isMigrated: true });
  });
}

/**
 * Decrypts the stores in place and drops the key, which has to happen before the passcode goes away: with the key
 * gone, encrypted records cannot be read. If it fails, the records stay readable and `enableEncryptionAtRest`
 * encrypts them again.
 */
export function disableEncryptionAtRest(store: SignalStore, db: MessageDb) {
  return runOne(async () => {
    const state = await store.getEncryptionState();
    if (!state) return;

    // New records are written in the clear from here on, and the key reads the others
    setAtRestWriting(false);
    await store.setEncryptionState({ state: 'decrypting', isMigrated: false });
    await store.runExclusive(() => Promise.resolve());
    await store.convertRecords('decrypt');
    await db.convertRecords('decrypt');
    await convertCachedBlobs('decrypt');
    await store.removeEncryptionState();
    await setAtRestKey(undefined);
  });
}

/**
 * What the engine does at start with the key that the page has: with one, it encrypts the stores if that is not
 * done yet; without one, it stops if the stores are encrypted, since showing the link screen would replace data
 * that is still readable with the key.
 */
export async function applyStorageKey(rawKey: ArrayBuffer | undefined, store: SignalStore, db: MessageDb) {
  if (rawKey) {
    await enableEncryptionAtRest(rawKey, store, db);
    return;
  }

  if (await store.getEncryptionState()) throw new StorageLockedError();
}

/** The engine forgets the key when the account is forgotten, so a new account is not encrypted with a dead key */
export function forgetStorageKey() {
  return setAtRestKey(undefined);
}

function runOne<T>(task: () => Promise<T>) {
  const result = queue.then(task);
  queue = result.catch(() => undefined);
  return result;
}
