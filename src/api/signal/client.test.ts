import 'fake-indexeddb/auto';

import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';

import type { ApiInitialArgs, ApiUpdate } from '../types';

import { startDeviceLink } from '../../lib/signal/account/provisioning';
import { HttpError, sendJsonRequest } from '../../lib/signal/net/rest';
import { WebSocketConnectError } from '../../lib/signal/net/WebSocketClient';
import { clearAttachmentCache } from './media/attachments';
import { startClient, stopClient } from './client';
import { client, db, store } from './engine';
import { initUpdates } from './updates';

vi.mock('../../lib/signal/wasm', () => ({ initSignalWasm: vi.fn(), wasm: {} }));
vi.mock('../../lib/signal/account/provisioning', () => ({ startDeviceLink: vi.fn() }));
vi.mock('../../lib/signal/net/rest', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/signal/net/rest')>(),
  sendJsonRequest: vi.fn(),
}));
vi.mock('./media/attachments', () => ({ clearAttachmentCache: vi.fn() }));

const ACI = '3d0c8e0f-6c1f-4f3a-9d7e-1f2a3b4c5d6e';
const ARGS: ApiInitialArgs = { userAgent: 'test', langCode: 'en' };
const LINKED_DEVICE_ID = 2;
const PRIMARY_DEVICE_ID = 1;

let updates: ApiUpdate[];

// The fake server: the chat socket answers the handshake with `socketStatus`, and `whoami` with `whoamiAnswer`
function setServer(socketStatus: number, whoamiAnswer: number | Error) {
  vi.spyOn(client, 'connect').mockRejectedValue(new WebSocketConnectError(socketStatus));
  vi.mocked(sendJsonRequest).mockImplementation(() => {
    if (whoamiAnswer instanceof Error) return Promise.reject(whoamiAnswer);
    if (whoamiAnswer !== 200) return Promise.reject(new HttpError(whoamiAnswer, 'whoami'));
    return Promise.resolve({});
  });
}

async function seedAccount(deviceId: number) {
  await store.setItem('account', {
    aci: ACI, deviceId, password: 'secret', registrationId: 1, pniRegistrationId: 2,
  });
  await store.setSession(`${ACI}.1`, new Uint8Array([1, 2, 3]));
  await db.putConversation({
    id: 'peer', localId: 7, type: 'private', unreadCount: 0, profileName: 'Alice',
  });
  await db.addMessage({
    conversationId: 'peer', kind: 'message', authorAci: 'peer', sentAt: 1, receivedAt: 1, isOutgoing: false, body: 'Hi',
  });
}

function getUpdateTypes() {
  return updates.map((update) => update['@type']);
}

beforeEach(async () => {
  updates = [];
  initUpdates((update) => updates.push(update));
  await store.clear();
  await db.clear();
});

afterEach(async () => {
  await stopClient(false);
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('a device that the server no longer accepts', () => {
  test.each([
    ['unlinked by the phone', 401, 401, LINKED_DEVICE_ID, 'unlinked'],
    ['refused with 403', 403, 403, LINKED_DEVICE_ID, 'unlinked'],
    ['primary device registered elsewhere', 401, 401, PRIMARY_DEVICE_ID, 'deregistered'],
  ] as const)('%s loses its data and shows the link screen', async (_, socketStatus, whoami, deviceId, reason) => {
    await seedAccount(deviceId);
    setServer(socketStatus, whoami);

    await startClient(ARGS);

    expect(await store.getItem('account')).toBeUndefined();
    expect(await store.getSession(`${ACI}.1`)).toBeUndefined();
    expect(await db.countMessages('peer')).toBe(0);
    expect(await db.getConversations()).toEqual([]);
    expect(clearAttachmentCache).toHaveBeenCalled();
    // The app logs out like on the user's logout, which clears its own state
    expect(updates).toContainEqual({ '@type': 'updateConnectionState', connectionState: 'connectionStateBroken' });

    // The app starts the engine again, which shows the link screen and then the reason
    vi.mocked(startDeviceLink).mockResolvedValue({
      url: 'sgnl://linkdevice', provisionMessage: new Promise(() => undefined), cancel: vi.fn(),
    } as never);
    updates = [];
    await startClient(ARGS);
    await vi.waitFor(() => expect(getUpdateTypes()).toContain('updateDeviceDeauthorized'));

    const types = getUpdateTypes();
    expect(types.indexOf('updateAuthorizationState')).toBeLessThan(types.indexOf('updateDeviceDeauthorized'));
    expect(updates).toContainEqual({ '@type': 'updateDeviceDeauthorized', reason });
    expect(await store.getItem('account')).toBeUndefined();
  });

  test('stays when the account is accepted again after a 401 on the socket', async () => {
    await seedAccount(LINKED_DEVICE_ID);
    setServer(401, 200);

    await startClient(ARGS);

    expect(await store.getItem('account')).toBeDefined();
    expect(await db.countMessages('peer')).toBe(1);
    expect(clearAttachmentCache).not.toHaveBeenCalled();
    expect(getUpdateTypes()).not.toContain('updateDeviceDeauthorized');
    expect(updates).not.toContainEqual({ '@type': 'updateConnectionState', connectionState: 'connectionStateBroken' });
  });

  test('stays when the confirmation fails with a network error', async () => {
    await seedAccount(LINKED_DEVICE_ID);
    setServer(401, new Error('tunnel unreachable'));

    await startClient(ARGS);

    expect(await store.getItem('account')).toBeDefined();
    expect(await db.countMessages('peer')).toBe(1);
    expect(clearAttachmentCache).not.toHaveBeenCalled();
    expect(updates).not.toContainEqual({ '@type': 'updateConnectionState', connectionState: 'connectionStateBroken' });
  });

  test('stays when the confirmation fails with a server error', async () => {
    await seedAccount(LINKED_DEVICE_ID);
    setServer(401, 500);

    await startClient(ARGS);

    expect(await store.getItem('account')).toBeDefined();
    expect(await db.countMessages('peer')).toBe(1);
  });

  test('stays when the socket fails with a network error', async () => {
    await seedAccount(LINKED_DEVICE_ID);
    vi.spyOn(client, 'connect').mockRejectedValue(new Error('socket closed'));

    await startClient(ARGS);

    expect(await store.getItem('account')).toBeDefined();
    expect(await db.countMessages('peer')).toBe(1);
    expect(sendJsonRequest).not.toHaveBeenCalled();
  });
});

test('removes the messages that no account owns when the link screen starts', async () => {
  await db.putConversation({
    id: 'peer', localId: 7, type: 'private', unreadCount: 0, profileName: 'Alice',
  });
  vi.mocked(startDeviceLink).mockResolvedValue({
    url: 'sgnl://linkdevice', provisionMessage: new Promise(() => undefined), cancel: vi.fn(),
  } as never);

  await startClient(ARGS);

  expect(await db.getConversations()).toEqual([]);
});
