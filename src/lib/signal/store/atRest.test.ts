import 'fake-indexeddb/auto';

import {
  afterEach, beforeEach, describe, expect, test,
} from 'vitest';

import { IdbStore } from '../../../util/browser/idb';
import { decryptBlob, encryptBlob, isEncryptedBlob } from '../attachments/blobEncryption';
import {
  decodeValue, decryptValue, encodeValue, encryptValue, isEncryptedValue, setAtRestKey, StorageLockedError,
} from './atRest';
import { applyStorageKey, disableEncryptionAtRest, enableEncryptionAtRest } from './atRestMigration';

import MessageDb, { type MessageRecord } from '../db/MessageDb';
import SignalStore from './SignalStore';

const ACI = '3d0c8e0f-6c1f-4f3a-9d7e-1f2a3b4c5d6e';
const OTHER_ACI = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SECRET_PASSWORD = 'correct-horse-battery-staple';
const SECRET_TEXT = 'meet me behind the station at midnight';
const KEY = new Uint8Array(32).fill(7).buffer;
const OTHER_KEY = new Uint8Array(32).fill(9).buffer;

function toText(value: unknown) {
  return JSON.stringify(value, (_key, item) => (item instanceof Uint8Array ? Array.from(item) : item));
}

function hasText(value: unknown, text: string) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const haystack = toText(value);
  // Strings appear as text in plain records, and as byte values inside typed arrays
  return haystack.includes(text) || haystack.includes(bytes.join(','));
}

async function readAll(name: string, storeName: string) {
  return new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const all = db.transaction(storeName).objectStore(storeName).getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result);
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
    body: `${SECRET_TEXT} ${index}`,
    dataMessage: new Uint8Array([index, 2, 3]),
    ...overrides,
  };
}

async function clearAll() {
  await setAtRestKey(undefined);
  await new SignalStore().clear();
  await new MessageDb().clear();
}

beforeEach(clearAll);
afterEach(clearAll);

describe('value encoding', () => {
  test('keeps bytes, bigint, Map, Set, Date and special numbers', () => {
    const value = {
      bytes: new Uint8Array([1, 2, 255]),
      nested: [{ big: 2n ** 70n, empty: new Uint8Array(0) }, undefined, 'text'],
      map: new Map([['a', new Uint8Array([9])]]),
      set: new Set([1, 2]),
      date: new Date(1234),
      numbers: [Number.NaN, Infinity, -0.5],
      omitted: undefined,
    };
    const decoded = decodeValue(encodeValue(value)) as typeof value;

    expect(decoded.bytes).toEqual(value.bytes);
    expect(decoded.nested[0]).toEqual(value.nested[0]);
    expect(decoded.nested[2]).toBe('text');
    expect(decoded.map.get('a')).toEqual(new Uint8Array([9]));
    expect(decoded.set.has(2)).toBe(true);
    expect(decoded.date.getTime()).toBe(1234);
    expect(decoded.numbers[0]).toBeNaN();
    expect(decoded.numbers[1]).toBe(Infinity);
    expect(decoded.omitted).toBeUndefined();
    expect(decodeValue(encodeValue(undefined))).toBeUndefined();
  });

  test('refuses values that it could not restore', () => {
    expect(() => encodeValue({ $t: 'b' })).toThrow();
    expect(() => encodeValue({ view: new Uint16Array(2) })).toThrow();
  });

  test('is bound to the key and the context', async () => {
    await setAtRestKey(KEY);
    const encrypted = await encryptValue('record|a', { secret: SECRET_PASSWORD });
    expect(isEncryptedValue(encrypted)).toBe(true);
    expect(hasText(encrypted, SECRET_PASSWORD)).toBe(false);
    expect(await decryptValue('record|a', encrypted)).toEqual({ secret: SECRET_PASSWORD });

    await expect(decryptValue('record|b', encrypted)).rejects.toThrow();
    await setAtRestKey(OTHER_KEY);
    await expect(decryptValue('record|a', encrypted)).rejects.toThrow();
    await setAtRestKey(undefined);
    await expect(decryptValue('record|a', encrypted)).rejects.toBeInstanceOf(StorageLockedError);
  });
});

describe('SignalStore', () => {
  async function fillStore(store: SignalStore) {
    await store.setItem('account', {
      aci: ACI, deviceId: 2, password: SECRET_PASSWORD, registrationId: 1, pniRegistrationId: 2,
    });
    await store.setSession(`${ACI}.1`, new Uint8Array([4, 5, 6]));
    await store.addUnprocessed({ id: 'one', envelope: new Uint8Array([1]), receivedAt: 2 });
    await store.addSentProto({
      timestamp: 5, content: new Uint8Array([1, 2]), contentHint: 0, recipients: [], isUrgent: false, savedAt: 1,
    });
  }

  test('writes encrypted records, reads them back and keeps the keys readable', async () => {
    const store = new SignalStore();
    await setAtRestKey(KEY);
    await fillStore(store);

    const raw = await readAll('ts-signal', 'store');
    expect(raw).toHaveLength(4);
    expect(raw.every(isEncryptedValue)).toBe(true);
    expect(hasText(raw, SECRET_PASSWORD)).toBe(false);

    expect((await store.getItem('account'))?.password).toBe(SECRET_PASSWORD);
    expect(await store.getSession(`${ACI}.1`)).toEqual(new Uint8Array([4, 5, 6]));
    expect(await store.getSessionDeviceIds(ACI)).toEqual([1]);
    expect((await store.getAllUnprocessed()).map(({ id }) => id)).toEqual(['one']);
    await store.removeSentProtosBefore(10);
    expect(await store.getSentProto(5)).toBeUndefined();
  });

  test('stops reading encrypted records without the key', async () => {
    const store = new SignalStore();
    await setAtRestKey(KEY);
    await fillStore(store);
    await store.setEncryptionState({ state: 'on', isMigrated: true });
    await setAtRestKey(undefined);

    await expect(store.getItem('account')).rejects.toBeInstanceOf(StorageLockedError);
    await expect(applyStorageKey(undefined, store, new MessageDb())).rejects.toBeInstanceOf(StorageLockedError);
  });

  test('encrypts records stored in the clear and decrypts them again', async () => {
    const store = new SignalStore();
    const db = new MessageDb();
    await fillStore(store);
    await db.addMessage(buildMessage(1));
    await applyStorageKey(undefined, store, db);

    await enableEncryptionAtRest(KEY, store, db);
    expect((await readAll('ts-signal', 'store')).filter((value) => !isEncryptedValue(value))).toEqual([
      { state: 'on', isMigrated: true },
    ]);
    expect(hasText(await readAll('ts-signal-messages', 'messages'), SECRET_TEXT)).toBe(false);
    expect((await store.getItem('account'))?.password).toBe(SECRET_PASSWORD);

    await disableEncryptionAtRest(store, db);
    const plain = await readAll('ts-signal', 'store');
    expect(plain.some((value) => hasText(value, SECRET_PASSWORD))).toBe(true);
    expect(plain.some(isEncryptedValue)).toBe(false);
    expect(await store.getEncryptionState()).toBeUndefined();
    expect(hasText(await readAll('ts-signal-messages', 'messages'), SECRET_TEXT)).toBe(true);
    // The key is gone and nothing needs it
    expect((await store.getItem('account'))?.password).toBe(SECRET_PASSWORD);
    expect((await db.getMessages(ACI, 10))[0].body).toContain(SECRET_TEXT);
  });

  test('resumes an interrupted encryption at the next start', async () => {
    const store = new SignalStore();
    const db = new MessageDb();
    await fillStore(store);
    await db.addMessage(buildMessage(1));
    // An interrupted run: the marker says so, one record is encrypted, the others are not
    await setAtRestKey(KEY);
    await store.setEncryptionState({ state: 'on', isMigrated: false });
    await store.setSession(`${ACI}.1`, new Uint8Array([4, 5, 6]));
    await setAtRestKey(undefined);

    await applyStorageKey(KEY, store, db);
    expect((await readAll('ts-signal', 'store')).filter((value) => !isEncryptedValue(value))).toHaveLength(1);
    expect((await store.getEncryptionState())?.isMigrated).toBe(true);
    expect(hasText(await readAll('ts-signal-messages', 'messages'), SECRET_TEXT)).toBe(false);
  });
});

describe('MessageDb', () => {
  test('keeps only the fields of its indexes in the clear', async () => {
    const db = new MessageDb();
    await setAtRestKey(KEY);
    await db.putConversation({
      id: ACI, localId: 1, type: 'private', unreadCount: 0, profileName: 'Alice Liddell', e164: '+15550100001',
    });
    const added = await db.addMessage(buildMessage(1, {
      expiresAt: 5000, sendRetry: { startedAt: 1, attempt: 0, at: 77 },
    }));
    await db.addStory({
      conversationId: ACI,
      authorAci: ACI,
      sentAt: 9,
      receivedAt: 9,
      expiresAt: 9000,
      isOutgoing: false,
      storyMessage: new Uint8Array([1]),
    });

    const [conversation] = await readAll('ts-signal-messages', 'conversations') as Record<string, unknown>[];
    const [message] = await readAll('ts-signal-messages', 'messages') as Record<string, unknown>[];
    const [story] = await readAll('ts-signal-messages', 'stories') as Record<string, unknown>[];
    expect(Object.keys(conversation).sort()).toEqual(['enc', 'id', 'localId']);
    expect(Object.keys(message).sort()).toEqual(
      ['authorAci', 'conversationId', 'enc', 'expiresAt', 'id', 'sendRetry', 'sentAt'],
    );
    expect(message.sendRetry).toEqual({ at: 77 });
    expect(Object.keys(story).sort()).toEqual(['authorAci', 'enc', 'expiresAt', 'id', 'sentAt']);
    expect([conversation, message, story].some((value) => hasText(value, 'Alice') || hasText(value, SECRET_TEXT)))
      .toBe(false);

    expect((await db.getMessage(added.id))?.body).toBe(`${SECRET_TEXT} 1`);
    expect((await db.getConversationByLocalId(1))?.profileName).toBe('Alice Liddell');
    expect((await db.getConversations())[0].e164).toBe('+15550100001');
    expect((await db.getStories())[0].storyMessage).toEqual(new Uint8Array([1]));
  });

  test('answers every query as it does for records in the clear', async () => {
    const db = new MessageDb();
    const queries = async () => ({
      newest: (await db.getMessages(ACI, 3)).map(({ sentAt }) => sentAt),
      older: (await db.getMessages(ACI, 3, 5)).map(({ sentAt }) => sentAt),
      from: (await db.getMessagesFrom(ACI, 2, 4)).map(({ sentAt }) => sentAt),
      latestOdd: (await db.findLatestMessages(ACI, 2, ({ sentAt }) => sentAt % 2 === 0)).map(({ sentAt }) => sentAt),
      latestNone: (await db.findLatestMessages(ACI, 2, () => false)).length,
      unread: (await db.getUnreadMessages(ACI)).length,
      found: (await db.findMessage(ACI, 1003))?.body,
      count: await db.countMessages(ACI),
      expired: (await db.getExpiredMessages(3000)).map(({ sentAt }) => sentAt),
      nextExpiry: await db.getNextExpiresAt(),
      retry: (await db.getMessagesToRetry()).map(({ sentAt }) => sentAt),
      oldest: await db.getOldestSentAt(ACI),
    });
    for (let index = 1; index <= 250; index++) {
      await db.addMessage(buildMessage(index, {
        readAt: index > 240 ? undefined : 1,
        expiresAt: index === 7 ? 2500 : undefined,
        sendRetry: index === 9 ? { startedAt: 1, attempt: 0, at: 5 } : undefined,
      }));
    }
    const plain = await queries();

    await setAtRestKey(KEY);
    await db.convertRecords('encrypt');
    expect(hasText(await readAll('ts-signal-messages', 'messages'), SECRET_TEXT)).toBe(false);
    expect(await queries()).toEqual(plain);

    await db.addMessage(buildMessage(251));
    expect((await db.getMessages(ACI, 1))[0].sentAt).toBe(1251);
    const [first] = await db.getMessagesFrom(ACI, 1, 0);
    expect(await db.deleteConversationMessages(ACI, first.id + 4)).toHaveLength(5);

    await db.convertRecords('decrypt');
    expect(hasText(await readAll('ts-signal-messages', 'messages'), SECRET_TEXT)).toBe(true);
    expect((await db.getMessages(ACI, 1))[0].sentAt).toBe(1251);
  });

  test('rejects a record that was moved to another conversation', async () => {
    const db = new MessageDb();
    await setAtRestKey(KEY);
    await db.addMessage(buildMessage(1));
    const request = indexedDB.open('ts-signal-messages');
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const store = request.result.transaction('messages', 'readwrite').objectStore('messages');
        store.openCursor().onsuccess = ({ target }) => {
          const cursor = (target as IDBRequest<IDBCursorWithValue>).result;
          cursor.update({ ...cursor.value, conversationId: OTHER_ACI });
          resolve();
        };
      };
    });
    await expect(db.getMessages(OTHER_ACI, 5)).rejects.toThrow();
  });
});

describe('Encrypted files', () => {
  test('round trip in chunks, with the type inside', async () => {
    await setAtRestKey(KEY);
    const data = new Uint8Array((1 << 20) + 123).map((_, index) => index % 251);
    const encrypted = await encryptBlob(new Blob([data], { type: 'image/png' }));

    expect(encrypted.type).toBe('application/octet-stream');
    expect(await isEncryptedBlob(encrypted)).toBe(true);
    expect(await isEncryptedBlob(new Blob(['plain']))).toBe(false);
    const decrypted = await decryptBlob(encrypted, (type) => type);
    expect(decrypted.type).toBe('image/png');
    expect(new Uint8Array(await decrypted.arrayBuffer())).toEqual(data);

    const empty = await decryptBlob(await encryptBlob(new Blob([], { type: 'audio/ogg' })), (type) => type);
    expect(empty.size).toBe(0);
    expect(empty.type).toBe('audio/ogg');
  }, 30000);

  test('refuses a cut, damaged or reordered file and another key', async () => {
    await setAtRestKey(KEY);
    const encrypted = await encryptBlob(new Blob([new Uint8Array((1 << 20) + 5)], { type: 'image/png' }));
    const bytes = new Uint8Array(await encrypted.arrayBuffer());

    await expect(decryptBlob(encrypted.slice(0, encrypted.size - 20), (type) => type)).rejects.toThrow();
    const damaged = bytes.slice();
    damaged[damaged.length - 30] ^= 1;
    await expect(decryptBlob(new Blob([damaged]), (type) => type)).rejects.toThrow();
    await setAtRestKey(OTHER_KEY);
    await expect(decryptBlob(encrypted, (type) => type)).rejects.toThrow();
  });
});

test('IdbStore sees only envelopes', async () => {
  const store = new SignalStore();
  await setAtRestKey(KEY);
  await store.setItem('account', {
    aci: ACI, deviceId: 2, password: SECRET_PASSWORD, registrationId: 1, pniRegistrationId: 2,
  });
  const raw = await new IdbStore('ts-signal').get('item:account');
  expect(isEncryptedValue(raw)).toBe(true);
});
