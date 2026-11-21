import * as cacheApi from '../../../util/cacheApi';
import { ACCOUNT_SLOT } from '../../../util/multiaccount';
import { ATTACHMENT_CACHE_NAME, convertCachedBlobs, countCachedBlobs } from '../attachments/attachmentCache';
import { getEngineSlots } from '../engineSlots';
import {
  clearAtRestRequirement, forgetAtRestKey, setAtRestKey, setAtRestWriting, StorageLockedError,
} from './atRest';
import { getRunningEngineSlots } from './engineLock';

import MessageDb from '../db/MessageDb';
import SignalStore from './SignalStore';

type Engine = { store: SignalStore; db: MessageDb };

/** How the engine's stores stand after the start with the page's key */
export type StartOutcome = 'ready' | 'wiped';

// A pass converts what the previous one missed, such as a record that the engine wrote meanwhile
const MAX_PASSES = 3;
// Records per store that the start looks at for one that a write left in the clear
const RECENT_SAMPLE_SIZE = 100;

// One change at a time: enabling and disabling rewrite the same records
let queue: Promise<unknown> = Promise.resolve();

/**
 * Gives the engine the key of the stores and encrypts what is stored in the clear, in place: this slot's stores and
 * the stores of the other slots whose engine is not running (a running one encrypts its own when it starts with the
 * key). New records are encrypted from the moment the key is set, so the rewrite only has the old ones to do, and an
 * interrupted one resumes at the next start. Returns `true` once a count finds nothing in the clear any more.
 */
export function enableEncryptionAtRest(rawKey: ArrayBuffer, store: SignalStore, db: MessageDb) {
  return runOne(async () => {
    await setAtRestKey(rawKey, true);
    const engine = { store, db };
    const state = await store.getEncryptionState();
    if (state?.state === 'on' && state.isMigrated && !await hasPlainRecordsAtStart(engine)) return true;

    const engines = [engine, ...await getIdleEngines()];
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
export function disableEncryptionAtRest(store: SignalStore, db: MessageDb) {
  return runOne(async () => {
    if ((await getRunningEngineSlots()).some((slot) => slot !== (ACCOUNT_SLOT || 1))) {
      // eslint-disable-next-line no-console
      console.error('[signal] The engine of another account is running, so the stores cannot be decrypted');
      return false;
    }

    const engines = [{ store, db }, ...await getIdleEngines()];
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
 * yet; a failure other than a missing key goes to `onError`, and the engine starts anyway: the records stay readable
 * and the next start tries again. Without one there is no passcode, so encrypted stores cannot be opened any more
 * and are wiped, which shows the link screen; plain stores need no key.
 */
export async function applyStorageKey(
  rawKey: ArrayBuffer | undefined,
  store: SignalStore,
  db: MessageDb,
  onError: (error: unknown) => void,
): Promise<StartOutcome> {
  if (rawKey) {
    try {
      await enableEncryptionAtRest(rawKey, store, db);
    } catch (err) {
      if (err instanceof StorageLockedError) throw err;
      onError(err);
    }
    return 'ready';
  }

  if (await store.getEncryptionState()) {
    await wipeStores(store, db);
    return 'wiped';
  }
  clearAtRestRequirement();
  return 'ready';
}

/** Removes the records that nothing can read any more, and the marker that says they are encrypted */
export async function wipeStores(store: SignalStore, db: MessageDb) {
  await Promise.all([store.clear(), db.clear(), cacheApi.clear(ATTACHMENT_CACHE_NAME)]);
  clearAtRestRequirement();
}

/** The engine drops the key when it stops, but stays unable to write records in the clear */
export function forgetStorageKey() {
  forgetAtRestKey();
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

/** The stores of the other slots whose engine does not run */
async function getIdleEngines(): Promise<Engine[]> {
  const running = new Set(await getRunningEngineSlots());
  const own = ACCOUNT_SLOT || 1;
  return [...await getEngineSlots()]
    .filter((slot) => slot !== own && !running.has(slot))
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
