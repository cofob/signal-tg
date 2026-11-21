import { ACCOUNT_SLOT } from '../../../util/multiaccount';
import { convertCachedBlobs, countCachedBlobs } from '../attachments/attachmentCache';
import { getEngineSlots } from '../engineSlots';
import {
  clearAtRestRequirement, forgetAtRestKey, setAtRestKey, setAtRestWriting, StorageLockedError,
} from './atRest';
import { getRunningEngineSlots } from './engineLock';

import MessageDb from '../db/MessageDb';
import SignalStore from './SignalStore';

type Engine = { store: SignalStore; db: MessageDb };

// A pass converts what the previous one missed, such as a record that the engine wrote meanwhile
const MAX_PASSES = 3;
// Records per store that the start looks at for one that a write left in the clear
const RECENT_SAMPLE_SIZE = 100;

// One change at a time: enabling and disabling rewrite the same records
let queue: Promise<unknown> = Promise.resolve();
// The key that this engine has been given and that has not been taken away since, kept so that a wipe in the middle of
// a session (such as a relink) can set it again
let activeRawKey: ArrayBuffer | undefined;

/**
 * Gives the engine the key of the stores and encrypts what is stored in the clear, in place: this slot's stores and
 * the stores of the other slots whose engine is not running (a running one encrypts its own when it starts with the
 * key). New records are encrypted from the moment the key is set, so the rewrite only has the old ones to do, and an
 * interrupted one resumes at the next start. Returns `true` once a count finds nothing in the clear any more.
 */
export function enableEncryptionAtRest(
  rawKey: ArrayBuffer, store: SignalStore, db: MessageDb, slots?: number[],
) {
  return runOne(async () => {
    try {
      await setAtRestKey(rawKey, true);
    } catch (err) {
      // A key that cannot be used is no key: the stores that it should open stay closed
      throw new StorageLockedError();
    }
    activeRawKey = rawKey.slice(0);
    const engine = { store, db };
    const state = await store.getEncryptionState();
    if (state?.state === 'on' && state.isMigrated && !await hasPlainRecordsAtStart(engine)) return true;

    const engines = [engine, ...await getIdleEngines(slots)];
    for (const { store: slotStore } of engines) {
      await slotStore.setEncryptionState({ state: 'on', isMigrated: false });
    }
    // Operations that began before the key was set finish first, so none of them writes in the clear afterwards
    await store.runExclusive(() => Promise.resolve());

    let isClean = false;
    for (let pass = 0; pass < MAX_PASSES && !isClean; pass++) {
      for (const { store: slotStore, db: slotDb } of engines) {
        await slotStore.convertRecords('encrypt');
        await slotDb.convertRecords('encrypt');
      }
      await convertCachedBlobs('encrypt');
      isClean = (await countEncryption(engines)).plain === 0;
    }
    if (!isClean) return false;

    for (const { store: slotStore } of engines) {
      await slotStore.setEncryptionState({ state: 'on', isMigrated: true });
    }
    return true;
  });
}

/**
 * Decrypts the stores of every slot and the cached files in place, and drops the key, which has to happen before the
 * passcode goes away: with the key gone, encrypted records cannot be read. It repeats until a count finds no encrypted
 * record, and returns `true` only then. Anything else leaves the key and the records readable, writes encrypted again,
 * and returns `false`: a record that the key does not open (`eraseUnreadableRecords` removes those on request), or
 * another slot whose engine is running, which would keep writing encrypted records.
 */
export function disableEncryptionAtRest(store: SignalStore, db: MessageDb, slots?: number[]) {
  return runOne(async () => {
    const otherSlots = (slots ?? [...await getEngineSlots()]).filter((slot) => slot !== getOwnSlot());
    const running = await getRunningEngineSlots();
    // A browser that cannot tell which engines run is trusted only when there is no other slot to be wrong about
    if (running ? running.some((slot) => slot !== getOwnSlot()) : otherSlots.length > 0) {
      // eslint-disable-next-line no-console
      console.error('[signal] The engine of another account may be running, so the stores cannot be decrypted');
      return false;
    }

    const engines = [{ store, db }, ...await getIdleEngines(slots)];
    // New records are written in the clear from here on, and the key reads the others
    setAtRestWriting(false);
    for (const { store: slotStore } of engines) {
      await slotStore.setEncryptionState({ state: 'decrypting', isMigrated: false });
    }
    await store.runExclusive(() => Promise.resolve());

    let counts = await countEncryption(engines);
    let failedCount = 0;
    for (let pass = 0; pass < MAX_PASSES && counts.encrypted > 0; pass++) {
      failedCount = 0;
      for (const { store: slotStore, db: slotDb } of engines) {
        failedCount += await slotStore.convertRecords('decrypt');
        failedCount += await slotDb.convertRecords('decrypt');
      }
      await convertCachedBlobs('decrypt');
      counts = await countEncryption(engines);
    }

    if (counts.encrypted > 0) {
      // eslint-disable-next-line no-console
      console.error(`[signal] ${failedCount || counts.encrypted} records cannot be decrypted, so the key stays`);
      setAtRestWriting(true);
      for (const { store: slotStore } of engines) {
        await slotStore.setEncryptionState({ state: 'on', isMigrated: false });
      }
      return false;
    }

    for (const { store: slotStore } of engines) await slotStore.removeEncryptionState();
    await setAtRestKey(undefined);
    activeRawKey = undefined;
    return true;
  });
}

/** Deletes the records of every slot that the key does not open, and returns their number */
export function eraseUnreadableRecords(store: SignalStore, db: MessageDb) {
  return runOne(async () => {
    const engines = [{ store, db }, ...await getIdleEngines()];
    let erasedCount = 0;
    for (const { store: slotStore, db: slotDb } of engines) {
      erasedCount += await slotStore.deleteUnreadableRecords();
      erasedCount += await slotDb.deleteUnreadableRecords();
    }
    return erasedCount;
  });
}

/**
 * What the engine does at start with the key that the page has. With one, it encrypts the stores if that is not done
 * yet; a key that cannot be used throws `StorageLockedError`, and any other failure goes to `onError`, so that the
 * engine starts and the next start tries again. Without one, a store that is marked encrypted cannot be opened:
 * that throws `StorageLockedError` too, and the engine does not start. Nothing is wiped here, since a missing key can
 * be a race with a tab that is turning the passcode on or off; the user decides what happens to the data.
 */
export async function applyStorageKey(
  rawKey: ArrayBuffer | undefined,
  store: SignalStore,
  db: MessageDb,
  onError: (error: unknown) => void,
) {
  if (rawKey) {
    try {
      await enableEncryptionAtRest(rawKey, store, db);
    } catch (err) {
      if (err instanceof StorageLockedError) throw err;
      onError(err);
    }
    return;
  }

  if (await store.getEncryptionState()) throw new StorageLockedError();
  clearAtRestRequirement();
}

/** The engine drops the key when it stops, but stays unable to write records in the clear */
export function forgetStorageKey() {
  forgetAtRestKey();
  activeRawKey = undefined;
}

/**
 * After a wipe in the middle of a session, such as a relink: the account that is stored next is encrypted with the
 * key that the engine had, or, with none, written in the clear, which the next start with a key encrypts
 */
export async function reapplyStorageKey(store: SignalStore, db: MessageDb) {
  if (activeRawKey) {
    await enableEncryptionAtRest(activeRawKey, store, db);
  } else {
    clearAtRestRequirement();
  }
}

/** Whether any slot's stores hold an encrypted record, which only the passcode's key opens; needs no key */
export async function hasEncryptedEngineData() {
  for (const slot of await getEngineSlots()) {
    if ((await new SignalStore(slot).countRecords()).encrypted > 0) return true;
    const counts = Object.values(await new MessageDb(slot).countRecords());
    if (counts.some(({ encrypted }) => encrypted > 0)) return true;
  }
  return false;
}

async function hasPlainRecordsAtStart({ store, db }: Engine) {
  return (await store.countRecords()).plain > 0 || db.hasRecentPlainRecords(RECENT_SAMPLE_SIZE);
}

function getOwnSlot() {
  return ACCOUNT_SLOT || 1;
}

/** The stores of the other slots whose engine does not run; `slots` is the page's list, which knows the sessions */
async function getIdleEngines(slots?: number[]): Promise<Engine[]> {
  const running = new Set(await getRunningEngineSlots());
  return [...new Set([...slots ?? [], ...await getEngineSlots()])]
    .filter((slot) => slot !== getOwnSlot() && !running.has(slot))
    .map((slot) => ({ store: new SignalStore(slot), db: new MessageDb(slot) }));
}

/** How many records are encrypted and how many are not, in the stores of these engines and in the cached files */
async function countEncryption(engines: Engine[]) {
  const counts = await countCachedBlobs();
  for (const { store, db } of engines) {
    const storeCounts = await store.countRecords();
    counts.encrypted += storeCounts.encrypted;
    counts.plain += storeCounts.plain;
    for (const { encrypted, plain } of Object.values(await db.countRecords())) {
      counts.encrypted += encrypted;
      counts.plain += plain;
    }
  }
  return counts;
}

function runOne<T>(task: () => Promise<T>) {
  const result = queue.then(task);
  queue = result.catch(() => undefined);
  return result;
}
