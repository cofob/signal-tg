import 'fake-indexeddb/auto';

import { expect, test } from 'vitest';

import clearSignalLocalData from './clearLocalData';

import MessageDb from './db/MessageDb';
import SignalStore from './store/SignalStore';

const ACI = '3d0c8e0f-6c1f-4f3a-9d7e-1f2a3b4c5d6e';

test('removes the account, keys and messages without a running engine', async () => {
  const store = new SignalStore();
  const db = new MessageDb();
  await store.setItem('account', {
    aci: ACI, deviceId: 2, password: 'secret', registrationId: 1, pniRegistrationId: 2,
  });
  await store.setSession(`${ACI}.1`, new Uint8Array([1, 2, 3]));
  await db.putConversation({
    id: ACI, localId: 1, type: 'private', unreadCount: 0, profileName: 'Alice',
  });
  await db.addMessage({
    conversationId: ACI, kind: 'message', authorAci: ACI, sentAt: 1, receivedAt: 1, isOutgoing: false, body: 'Hi',
  });
  expect(await store.getItem('account')).toBeDefined();
  expect(await db.countMessages(ACI)).toBe(1);

  // Another instance, as the main thread has while the engine's worker is not started
  await clearSignalLocalData();

  const reopenedStore = new SignalStore();
  const reopenedDb = new MessageDb();
  expect(await reopenedStore.getItem('account')).toBeUndefined();
  expect(await reopenedStore.getSession(`${ACI}.1`)).toBeUndefined();
  expect(await reopenedDb.getConversations()).toEqual([]);
  expect(await reopenedDb.countMessages(ACI)).toBe(0);
});
