import type { AccountRecord } from '../../lib/signal/store/SignalStore';
import type { ApiInitialArgs } from '../types';

import { DEBUG } from '../../config';
import { linkDevice } from '../../lib/signal/account/linkDevice';
import { startDeviceLink } from '../../lib/signal/account/provisioning';
import { WebSocketConnectError } from '../../lib/signal/net/WebSocketClient';
import { sendInitialSyncRequests } from '../../lib/signal/sender/syncRequests';
import { fetchStorageSnapshot } from '../../lib/signal/storage/storageService';
import { initSignalWasm } from '../../lib/signal/wasm';
import { buildApiUser } from './builders/users';
import {
  client, db, logError, processor, store,
} from './engine';
import { sendApiUpdate } from './updates';

const DEVICE_NAME = 'TeleSignal';
const LINK_QR_LIFETIME_S = 60 * 60;
const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60 * 1000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

let currentAccount: AccountRecord | undefined;
let reconnectDelay = RECONNECT_MIN_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let linkSession: Awaited<ReturnType<typeof startDeviceLink>> | undefined;
let isDestroyed = false;

/**
 * Starts the linked device: shows the link QR code until the phone scans it, or connects the stored account.
 * The app treats a linked account as authorized even while the connection is down, so local chats stay visible.
 */
export async function startClient(initialArgs: ApiInitialArgs) {
  isDestroyed = false;
  await initSignalWasm();
  sendApiUpdate({ '@type': 'updateApiReady' });

  const account = await store.getItem('account');
  if (account) {
    await startSession(account, false);
    return;
  }
  void runDeviceLink(initialArgs.platform).catch(logError);
}

export function getCurrentAccount() {
  return currentAccount;
}

/** Closes the connections; `shouldForget` also removes the account and every local message */
export async function stopClient(shouldForget: boolean) {
  isDestroyed = true;
  clearTimeout(reconnectTimer);
  linkSession?.cancel();
  processor.stop();
  client.close();
  currentAccount = undefined;
  if (shouldForget) {
    await store.clear();
    await db.clear();
  }
}

async function runDeviceLink(platform?: string) {
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });

  while (!isDestroyed) {
    linkSession = await startDeviceLink();
    sendApiUpdate({
      '@type': 'updateAuthorizationState',
      authorizationState: 'authorizationStateWaitQrCode',
      qrCode: { token: linkSession.url, expires: Math.floor(Date.now() / 1000) + LINK_QR_LIFETIME_S },
    });

    let message;
    try {
      message = await linkSession.provisionMessage;
    } catch {
      // The provisioning socket closed before a scan; show a new code
      continue;
    }

    const deviceName = platform ? `${DEVICE_NAME} (${platform})` : DEVICE_NAME;
    const account = await linkDevice(store, message, deviceName);
    await startSession(account, true);
    return;
  }
}

async function startSession(account: AccountRecord, isNewLink: boolean) {
  currentAccount = account;
  const self = await processor.getOrCreatePrivateConversation(account.aci);
  sendApiUpdate({
    '@type': 'updateCurrentUser',
    currentUser: buildApiUser(self, account.aci),
    currentUserFullInfo: {},
  });
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateReady' });

  if (account.isDemo && DEBUG) {
    sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
    return;
  }

  await connect();
  if (isNewLink && currentAccount) {
    const context = client.getSenderContext();
    await sendInitialSyncRequests(context);
    const snapshot = await fetchStorageSnapshot(context.account, context.connection).catch(logError);
    if (snapshot) await processor.applyStorageRecords([...snapshot.records.values()]);
  }
}

async function connect() {
  if (isDestroyed) return;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateConnecting' });

  try {
    await client.connect({
      onContent: (decrypted) => processor.processContent(decrypted),
      onClose: () => scheduleReconnect(),
      onError: logError,
    });
  } catch (err) {
    if (err instanceof WebSocketConnectError && (err.status === HTTP_UNAUTHORIZED || err.status === HTTP_FORBIDDEN)) {
      await handleUnlinked();
      return;
    }
    logError(err);
    scheduleReconnect();
    return;
  }

  reconnectDelay = RECONNECT_MIN_DELAY_MS;
  processor.start();
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
}

function scheduleReconnect() {
  if (isDestroyed) return;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateConnecting' });
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => void connect(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
}

/** The server no longer accepts this device: the phone unlinked it. Local data goes and a new link starts. */
async function handleUnlinked() {
  await stopClient(true);
  isDestroyed = false;
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateLoggingOut' });
  void runDeviceLink().catch(logError);
}
