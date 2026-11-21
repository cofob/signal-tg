import type { HistoryTransferProgress } from '../../lib/signal/backups/transferHistory';
import type { AccountRecord } from '../../lib/signal/store/SignalStore';
import type { ApiInitialArgs } from '../types';

import { DEBUG } from '../../config';
import { linkDevice, unlinkDevice } from '../../lib/signal/account/linkDevice';
import { startDeviceLink } from '../../lib/signal/account/provisioning';
import { getSignalTunnelUrl, setSignalProxyUrl } from '../../lib/signal/config';
import { closeIdleHttpConnections } from '../../lib/signal/net/http';
import { WebSocketConnectError } from '../../lib/signal/net/WebSocketClient';
import { sendInitialSyncRequests } from '../../lib/signal/sender/syncRequests';
import { initSignalWasm } from '../../lib/signal/wasm';
import { pause } from '../../util/schedulers';
import { buildApiUser } from './builders/users';
import { clearAttachmentCache } from './media/attachments';
import {
  client, db, logError, processor, store,
} from './engine';
import { sendApiUpdate } from './updates';

const DEVICE_NAME = 'TeleSignal';
const LINK_QR_LIFETIME_S = 60 * 60;
const LINK_RETRY_DELAY_MS = 3000;
const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60 * 1000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const PERCENT = 100;
// The error code of the dialog, see `READABLE_ERROR_KEYS` in `src/util/getReadableErrorText.ts`
const HISTORY_TRANSFER_FAILED_ERROR = 'SIGNAL_HISTORY_TRANSFER_FAILED';

let currentAccount: AccountRecord | undefined;
let reconnectDelay = RECONNECT_MIN_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let linkSession: Awaited<ReturnType<typeof startDeviceLink>> | undefined;
let isDestroyed = false;
let hasSyncedThisSession = false;
// Changes on every stop, so a device link loop of an earlier start ends instead of running beside a new one
let clientGeneration = 0;
let historyTransferController: AbortController | undefined;

/**
 * Starts the linked device: shows the link QR code until the phone scans it, or connects the stored account.
 * The app treats a linked account as authorized even while the connection is down, so local chats stay visible.
 */
export async function startClient(initialArgs: ApiInitialArgs) {
  isDestroyed = false;
  applyProxyUrl(initialArgs.signalProxyUrl);
  await initSignalWasm();
  sendApiUpdate({ '@type': 'updateApiReady' });

  const account = await store.getItem('account');
  if (account) {
    await startSession(account);
    return;
  }
  void runDeviceLink(initialArgs.platform).catch(logError);
}

export function getCurrentAccount() {
  return currentAccount;
}

/** Closes the connections; `shouldForget` also removes the account, every local message and attachment */
export async function stopClient(shouldForget: boolean) {
  isDestroyed = true;
  clientGeneration++;
  clearTimeout(reconnectTimer);
  linkSession?.cancel();
  historyTransferController?.abort();
  processor.stop();
  client.close();
  currentAccount = undefined;
  if (shouldForget) {
    await store.clear();
    await db.clear();
    await clearAttachmentCache();
  }
}

function applyProxyUrl(url: string | undefined) {
  const prevTunnelUrl = getSignalTunnelUrl();
  setSignalProxyUrl(url);
  if (getSignalTunnelUrl() !== prevTunnelUrl) closeIdleHttpConnections();
}

async function runDeviceLink(platform?: string) {
  const generation = clientGeneration;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });

  while (generation === clientGeneration) {
    let session;
    try {
      session = await startDeviceLink();
    } catch (err) {
      logError(err);
      await pause(LINK_RETRY_DELAY_MS);
      continue;
    }
    if (generation !== clientGeneration) {
      session.cancel();
      return;
    }
    linkSession = session;

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
    await startSession(account);
    return;
  }
}

async function startSession(storedAccount: AccountRecord) {
  let account = storedAccount;
  currentAccount = account;
  let hasHistoryTransferFailed = false;
  if (account.historyTransfer && account.ephemeralBackupKey && !account.isDemo) {
    const outcome = await runHistoryTransfer();
    if (isDestroyed) return;
    if (outcome === 'relink') {
      await handleRelinkRequested(account);
      return;
    }
    hasHistoryTransferFailed = outcome === 'failed';
    // The import stores account settings from the primary device
    account = (await store.getItem('account'))!;
    currentAccount = account;
  }

  const self = await processor.getOrCreatePrivateConversation(account.aci);
  sendApiUpdate({
    '@type': 'updateCurrentUser',
    currentUser: buildApiUser(self, account.aci),
    currentUserFullInfo: {},
  });
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateReady' });
  if (hasHistoryTransferFailed) {
    sendApiUpdate({ '@type': 'error', error: { message: HISTORY_TRANSFER_FAILED_ERROR, hasErrorKey: true } });
  }

  if (account.isDemo && DEBUG) {
    sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
    return;
  }

  hasSyncedThisSession = false;
  await connect();
}

/**
 * Link and sync: keeps the link screen in its syncing state while the message history from the primary device
 * is transferred. A failed transfer leaves the account linked, without the history.
 */
async function runHistoryTransfer(): Promise<'done' | 'failed' | 'relink'> {
  const controller = new AbortController();
  historyTransferController = controller;
  let lastSent: HistoryTransferProgress | undefined;
  const sendProgress = (progress: HistoryTransferProgress) => {
    const historySync = {
      step: progress.step,
      progress: progress.progress === undefined ? undefined : Math.floor(progress.progress * PERCENT) / PERCENT,
    };
    if (lastSent?.step === historySync.step && lastSent.progress === historySync.progress) return;
    lastSent = historySync;
    sendApiUpdate({
      '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateWaitQrCode', historySync,
    });
  };

  try {
    sendProgress({ step: 'waiting' });
    const { transferHistory } = await import('../../lib/signal/backups/transferHistory');
    const outcome = await transferHistory(store, processor, sendProgress, controller.signal);
    // eslint-disable-next-line no-console
    console.info('[signal] Message history transfer', outcome);
    return outcome.type === 'relink' ? 'relink' : 'done';
  } catch (err) {
    if (!controller.signal.aborted) logError(err);
    return 'failed';
  } finally {
    historyTransferController = undefined;
  }
}

/**
 * The primary device could not export the history and asks to link again, which it tells the user: this device
 * leaves the account and shows a new code
 */
async function handleRelinkRequested(account: AccountRecord) {
  await unlinkDevice(account).catch(logError);
  await stopClient(true);
  isDestroyed = false;
  void runDeviceLink().catch(logError);
}

/**
 * Runs once per session after the first connection: the sync requests to the primary device until they
 * succeed once for the account, then our profile and a storage service sync
 */
async function syncAfterConnect() {
  if (hasSyncedThisSession) return;
  hasSyncedThisSession = true;

  const context = client.getSenderContext();
  if (!context.account.isInitialSyncDone) {
    await sendInitialSyncRequests(context);
    await client.updateAccount({ isInitialSyncDone: true });
  }
  void processor.refreshProfile(context.account.aci).catch(logError);
  await processor.syncStorage();
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
  syncAfterConnect().catch(logError);
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
