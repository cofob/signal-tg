import 'fake-indexeddb/auto';

import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';

import { IdbStore } from '../../../util/browser/idb';
import { decryptBlob, encryptBlob, isEncryptedBlob } from '../attachments/blobEncryption';
import {
  clearAtRestRequirement, decryptValue, encodeValue, forgetAtRestKey, isEncryptedValue, setAtRestKey,
  StorageLockedError,
} from './atRest';
import {
  applyStorageKey, disableEncryptionAtRest, enableEncryptionAtRest, eraseUnreadableRecords,
  hasEncryptedEngineData,
} from './atRestMigration';

import MessageDb, { type MessageRecord } from '../db/MessageDb';
import SignalStore from './SignalStore';

const mocks = vi.hoisted(() => ({ onEncrypt: undefined as undefined | (() => Promise<void>) }));

vi.mock('./atRest', async (importOriginal) => {
  const original = await importOriginal<typeof import('./atRest')>();
  return {
    ...original,
    encryptValue: async (...args: Parameters<typeof original.encryptValue>) => {
      await mocks.onEncrypt?.();
      return original.encryptValue(...args);
    },
  };
});

const ACI = '3d0c8e0f-6c1f-4f3a-9d7e-1f2a3b4c5d6e';
const OTHER_ACI = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const KEY = new Uint8Array(32).fill(7).buffer;
const SECRET = 'meet me behind the station at midnight';
const ignore = () => undefined;

// IndexedDB and the decoder hand out arrays of different realms in this test environment
function normalize(value: unknown) {
  const toArray = (_key: string, item: unknown) => (ArrayBuffer.isView(item) ? Array.from(item as Uint8Array) : item);
  return JSON.parse(JSON.stringify(value, toArray));
}

async function readAll(name: string, storeName: string) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const all = db.transaction(storeName).objectStore(storeName).getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result as Record<string, unknown>[]);
      };
    };
  });
}

function buildMessage(index: number, overrides: Partial<MessageRecord> = {}): Omit<MessageRecord, 'id'> {
  return {
    conversationId: ACI,
    kind: 'message',
    authorAci: index % 2 ? ACI : OTHER_ACI,
    sentAt: 1000 + index,
    receivedAt: 1000 + index,
    isOutgoing: false,
    body: `${SECRET} ${index}`,
    dataMessage: new Uint8Array([index, 2, 3]),
    ...overrides,
  };
}

async function clearSlots() {
  await setAtRestKey(undefined);
  mocks.onEncrypt = undefined;
  for (const slot of [1, 2]) {
    await new SignalStore(slot).clear();
    await new MessageDb(slot).clear();
  }
  vi.unstubAllGlobals();
}

beforeEach(clearSlots);
afterEach(clearSlots);

describe('Records that round trip', () => {
  test('every field of every record type survives encryption', async () => {
    const db = new MessageDb();
    const conversation = {
      id: ACI,
      localId: 7,
      type: 'private' as const,
      e164: '+15550100001',
      profileName: 'Alice',
      unreadCount: 3,
      lastMessageAt: 12,
      isArchived: true,
      pinIndex: 2,
      pinnedMessages: [{ messageId: 4, pinnedAt: 5, expiresAt: 6 }],
      masterKey: new Uint8Array([1, 2, 3]),
    };
    const message = buildMessage(1, {
      editedAt: 77,
      revisions: [{ dataMessage: new Uint8Array([9]), editedAt: 5 }],
      reactions: [{ emoji: 'x', authorAci: ACI, sentAt: 3 }],
      recipientStatus: { [OTHER_ACI]: 'pending' },
      recipientErrors: { [OTHER_ACI]: 'network' },
      expireTimer: 60,
      expiresAt: 9000,
      readAt: 5,
      sendRetry: { startedAt: 11, attempt: 4, at: 15 },
      unavailableAttachmentIndexes: [0, 2],
      isSealedSender: true,
    });
    const story = {
      conversationId: ACI,
      authorAci: ACI,
      sentAt: 5,
      receivedAt: 6,
      expiresAt: 9,
      isOutgoing: true,
      storyMessage: new Uint8Array([1, 2]),
      recipients: {
        [OTHER_ACI]: {
          status: 'sent' as const, isAllowedToReply: true, distributionListIds: ['a'], viewedAt: 3,
        },
      },
      replies: [{ authorAci: ACI, sentAt: 4, body: 'hi' }],
    };
    const call = {
      callId: 'c1',
      peerId: ACI,
      mode: 'direct' as const,
      type: 'audio' as const,
      direction: 'incoming' as const,
      status: 'missed' as const,
      timestamp: 55,
      messageId: 3,
      isUnseen: true as const,
    };

    const readAllRecords = async () => ({
      conversations: await db.getConversations(),
      messages: await db.getMessages(ACI, 10),
      stories: await db.getStories(),
      calls: await db.getCalls(),
    });
    await db.putConversation(conversation);
    await db.addMessage(message);
    await db.addStory(story);
    await db.putCall(call);
    const plain = await readAllRecords();

    await setAtRestKey(KEY);
    expect(await db.convertRecords('encrypt')).toBe(0);
    expect((await readAll('ts-signal-messages', 'messages'))[0].sendRetry).toEqual({ at: 15 });
    expect(normalize(await readAllRecords())).toEqual(normalize(plain));
    // The retry state is whole, not the clear copy that the index needs
    expect((await db.getMessagesToRetry())[0].sendRetry).toEqual({ startedAt: 11, attempt: 4, at: 15 });

    // A record that is written again while encrypted comes back the same way
    const [stored] = await db.getMessages(ACI, 1);
    await db.putMessage({ ...stored, readAt: 6 });
    expect(normalize((await db.getMessages(ACI, 1))[0])).toEqual(normalize({ ...plain.messages[0], readAt: 6 }));

    expect(await db.convertRecords('decrypt')).toBe(0);
    expect((await db.getMessagesToRetry())[0].sendRetry).toEqual({ startedAt: 11, attempt: 4, at: 15 });
  });
});

describe('Writes without the key', () => {
  test('fail instead of storing records in the clear', async () => {
    const store = new SignalStore();
    const db = new MessageDb();
    await setAtRestKey(KEY);
    await store.setItem('account', {
      aci: ACI, deviceId: 2, password: 'p', registrationId: 1, pniRegistrationId: 2,
    });

    forgetAtRestKey();
    await expect(store.setSession('x', new Uint8Array([1]))).rejects.toBeInstanceOf(StorageLockedError);
    await expect(db.addMessage(buildMessage(1))).rejects.toBeInstanceOf(StorageLockedError);
    await expect(db.putConversation({ id: ACI, localId: 1, type: 'private', unreadCount: 0 }))
      .rejects.toBeInstanceOf(StorageLockedError);
    expect(await readAll('ts-signal-messages', 'messages')).toEqual([]);
    expect((await readAll('ts-signal', 'store')).every(isEncryptedValue)).toBe(true);

    // Once nothing needs the key (the stores are plain or wiped), writes go through again
    clearAtRestRequirement();
    await store.setSession('x', new Uint8Array([1]));
  });
});

describe('Starting the engine', () => {
  async function fillEncrypted() {
    const store = new SignalStore();
    const db = new MessageDb();
    await store.setSession('x', new Uint8Array([1]));
    await db.addMessage(buildMessage(1));
    await enableEncryptionAtRest(KEY, store, db);
    return { store, db };
  }

  test('stops when a key that is given cannot be applied, and wipes nothing', async () => {
    const { store, db } = await fillEncrypted();
    await setAtRestKey(undefined);
    const onError = vi.fn();

    await expect(applyStorageKey(new ArrayBuffer(5), store, db, onError)).rejects.toBeInstanceOf(StorageLockedError);

    expect(onError).not.toHaveBeenCalled();
    expect((await readAll('ts-signal', 'store')).some(isEncryptedValue)).toBe(true);
    expect((await readAll('ts-signal-messages', 'messages'))[0].enc).toBeDefined();
  });

  test('stops without a key while the stores are marked encrypted, and wipes nothing', async () => {
    const { store, db } = await fillEncrypted();
    await setAtRestKey(undefined);

    await expect(applyStorageKey(undefined, store, db, ignore)).rejects.toBeInstanceOf(StorageLockedError);

    expect(await store.getEncryptionState()).toEqual({ state: 'on', isMigrated: true });
    expect((await readAll('ts-signal', 'store')).some(isEncryptedValue)).toBe(true);
    expect((await readAll('ts-signal-messages', 'messages'))[0].enc).toBeDefined();
    // The key that comes late opens the data
    await enableEncryptionAtRest(KEY, store, db);
    expect(Array.from((await store.getSession('x'))!)).toEqual([1]);
  });

  test('starts without a key when the stores are plain', async () => {
    const store = new SignalStore();
    await store.setSession('x', new Uint8Array([1]));

    await applyStorageKey(undefined, store, new MessageDb(), ignore);

    await store.setSession('y', new Uint8Array([2]));
    expect(Array.from((await store.getSession('y'))!)).toEqual([2]);
  });

  test('finds a record that a write left in the clear', async () => {
    const store = new SignalStore();
    const db = new MessageDb();
    await enableEncryptionAtRest(KEY, store, db);
    expect((await store.getEncryptionState())?.isMigrated).toBe(true);

    await new IdbStore('ts-signal').set('session:leak', new Uint8Array([1]));
    await expect(enableEncryptionAtRest(KEY, store, db)).resolves.toBe(true);

    const records = await readAll('ts-signal', 'store');
    expect(records.every((value) => isEncryptedValue(value) || 'state' in value)).toBe(true);
  });
});

describe('Engine in a worker', () => {
  test('finds the slots without `localStorage`', async () => {
    new SignalStore(2);
    await new SignalStore(2).setSession('x', new Uint8Array([1]));
    vi.stubGlobal('localStorage', undefined);

    const store = new SignalStore();
    expect(await enableEncryptionAtRest(KEY, store, new MessageDb())).toBe(true);

    expect((await new SignalStore(2).getEncryptionState())?.state).toBe('on');
  });
});

describe('Turning encryption off', () => {
  // The browser tells that no other engine runs
  beforeEach(() => {
    vi.stubGlobal('navigator', { ...navigator, locks: { query: () => Promise.resolve({ held: [] }) } });
  });

  async function fill(slot: number) {
    const store = new SignalStore(slot);
    const db = new MessageDb(slot);
    await store.setSession(`${ACI}.1`, new Uint8Array([4, slot]));
    await db.addMessage(buildMessage(slot));
    return { store, db };
  }

  test('decrypts the stores of every slot, not only the running one', async () => {
    const first = await fill(1);
    const second = await fill(2);

    expect(await enableEncryptionAtRest(KEY, first.store, first.db)).toBe(true);
    // The other slot's engine is not running, so its stores were encrypted too
    expect((await readAll('ts-signal-2', 'store')).every(isEncryptedValue)).toBe(false);
    expect((await second.store.getEncryptionState())?.state).toBe('on');
    expect(await hasEncryptedEngineData()).toBe(true);
    expect((await readAll('ts-signal-messages-2', 'messages'))[0].enc).toBeDefined();

    expect(await disableEncryptionAtRest(first.store, first.db)).toBe(true);

    expect(await hasEncryptedEngineData()).toBe(false);
    expect((await second.db.getMessages(ACI, 5))[0].body).toContain(SECRET);
    expect(await second.store.getEncryptionState()).toBeUndefined();
    const [message] = await readAll('ts-signal-messages-2', 'messages');
    expect(message.body).toBe(`${SECRET} 2`);
  });

  test('refuses while another slot has a running engine', async () => {
    const first = await fill(1);
    await fill(2);
    await enableEncryptionAtRest(KEY, first.store, first.db);
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { query: () => Promise.resolve({ held: [{ name: 'ts-signal-engine-2' }] }) },
    });

    expect(await disableEncryptionAtRest(first.store, first.db)).toBe(false);

    expect(await hasEncryptedEngineData()).toBe(true);
  });

  test('refuses when the browser cannot tell which engines run and another slot has data', async () => {
    const first = await fill(1);
    await fill(2);
    await enableEncryptionAtRest(KEY, first.store, first.db);
    vi.stubGlobal('navigator', { ...navigator, locks: undefined });
    const failed = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await disableEncryptionAtRest(first.store, first.db)).toBe(false);

    expect(await hasEncryptedEngineData()).toBe(true);
    failed.mockRestore();
  });

  test('decrypts the slots that the page names, which the browser may not list', async () => {
    const first = await fill(1);
    const second = await fill(2);
    const databases = vi.spyOn(indexedDB, 'databases').mockResolvedValue([]);
    expect(await enableEncryptionAtRest(KEY, first.store, first.db, [1, 2])).toBe(true);
    expect((await second.store.getEncryptionState())?.state).toBe('on');

    expect(await disableEncryptionAtRest(first.store, first.db, [1, 2])).toBe(true);

    databases.mockRestore();
    expect(await hasEncryptedEngineData()).toBe(false);
    expect(await second.store.getEncryptionState()).toBeUndefined();
  });

  test('answers `false`, keeps the key and writes encrypted while a record cannot be decrypted', async () => {
    const store = new SignalStore();
    const db = new MessageDb();
    await db.addMessage(buildMessage(1));
    await db.addMessage(buildMessage(2));
    await enableEncryptionAtRest(KEY, store, db);
    // Damage one record's ciphertext
    const request = indexedDB.open('ts-signal-messages');
    await new Promise<void>((resolve) => {
      request.onsuccess = () => {
        const objectStore = request.result.transaction('messages', 'readwrite').objectStore('messages');
        objectStore.openCursor().onsuccess = ({ target }) => {
          const cursor = (target as IDBRequest<IDBCursorWithValue>).result;
          const { enc } = cursor.value;
          cursor.update({ ...cursor.value, enc: { ...enc, data: enc.data.map((byte: number) => byte ^ 1) } });
          resolve();
        };
      };
    });
    const unreadable = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // The damaged record is skipped by reads, not a failure of the whole chat
    expect(await db.getMessages(ACI, 10)).toHaveLength(1);
    expect(await disableEncryptionAtRest(store, db)).toBe(false);
    expect(unreadable).toHaveBeenCalled();
    expect((await store.getEncryptionState())).toEqual({ state: 'on', isMigrated: false });
    await store.setSession('after', new Uint8Array([1]));
    expect(isEncryptedValue((await readAll('ts-signal', 'store')).find((value) => isEncryptedValue(value)))).toBe(true);

    // Only on request are the records that nothing can read erased, and then turning it off works
    expect(await eraseUnreadableRecords(store, db)).toBe(1);
    expect(await disableEncryptionAtRest(store, db)).toBe(true);
    expect(await db.getMessages(ACI, 10)).toHaveLength(1);
    unreadable.mockRestore();
  });

  test('decrypts even when the marker is gone', async () => {
    const store = new SignalStore();
    const db = new MessageDb();
    await db.addMessage(buildMessage(1));
    await enableEncryptionAtRest(KEY, store, db);
    await store.removeEncryptionState();

    expect(await disableEncryptionAtRest(store, db)).toBe(true);

    expect(await hasEncryptedEngineData()).toBe(false);
  });

  test('answers `false` without the key while records are encrypted', async () => {
    const store = new SignalStore();
    const db = new MessageDb();
    await db.addMessage(buildMessage(1));
    await enableEncryptionAtRest(KEY, store, db);
    await setAtRestKey(undefined);

    await expect(disableEncryptionAtRest(store, db)).rejects.toBeInstanceOf(StorageLockedError);

    expect(await hasEncryptedEngineData()).toBe(true);
  });
});

describe('Converting a record', () => {
  test('does not bring back a key that was deleted meanwhile', async () => {
    const store = new SignalStore();
    await store.setSession('doomed', new Uint8Array([1]));
    await store.setSession('kept', new Uint8Array([2]));
    await setAtRestKey(KEY);
    mocks.onEncrypt = async () => {
      mocks.onEncrypt = undefined;
      await store.removeSession('doomed');
    };

    await store.convertRecords('encrypt');

    expect(await store.getSessionDeviceIds('doomed')).toEqual([]);
    expect((await new IdbStore('ts-signal').keys()).map(String)).toEqual(['session:kept']);
    expect(await store.getSession('kept')).toEqual(new Uint8Array([2]));
  });
});

describe('Encrypted files', () => {
  const PATH = '/attachment/one';

  test('a file in the clear that starts like an encrypted one is not taken for one', async () => {
    await setAtRestKey(KEY);
    const forged = new Blob([new Uint8Array([0x54, 0x53, 0x45, 0x32]), new Uint8Array(200).fill(5)]);

    expect(await isEncryptedBlob(forged, PATH)).toBe(false);
    expect(await isEncryptedBlob(await encryptBlob(forged, PATH), PATH)).toBe(true);
  });

  test('a file belongs to its cache key', async () => {
    await setAtRestKey(KEY);
    const encrypted = await encryptBlob(new Blob(['picture'], { type: 'image/png' }), PATH);

    expect(await isEncryptedBlob(encrypted, '/attachment/two')).toBe(false);
    await expect(decryptBlob(encrypted, '/attachment/two', (type) => type)).rejects.toThrow();
    expect(await (await decryptBlob(encrypted, PATH, (type) => type)).text()).toBe('picture');
  });

  test('frames of one file cannot be moved into another', async () => {
    await setAtRestKey(KEY);
    const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
    const first = await bytes(await encryptBlob(new Blob(['first picture'], { type: 'image/png' }), PATH));
    const second = await bytes(await encryptBlob(new Blob(['second picture'], { type: 'image/png' }), PATH));
    // The second file's frames under the first file's header
    const spliced = new Uint8Array([...first.slice(0, 20), ...second.slice(20)]);

    await expect(decryptBlob(new Blob([spliced]), PATH, (type) => type)).rejects.toThrow();
  });
});

test('values of a record cannot be read with the key of another context', async () => {
  await setAtRestKey(KEY);
  const encrypted = await (await import('./atRest')).encryptValue('a', encodeValue('x') && { secret: SECRET });

  await expect(decryptValue('b', encrypted)).rejects.toThrow();
});
