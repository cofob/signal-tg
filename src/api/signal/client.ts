import type { HistoryTransferProgress } from '../../lib/signal/backups/transferHistory';
import type { AccountRecord } from '../../lib/signal/store/SignalStore';
import type { ApiInitialArgs, ApiSessionData } from '../types';

import { DEBUG } from '../../config';
import { checkAccountAuthorized, linkDevice, unlinkDevice } from '../../lib/signal/account/linkDevice';
import { startDeviceLink } from '../../lib/signal/account/provisioning';
import { resumePendingRegistration } from '../../lib/signal/account/register';
import { resetCdsiState } from '../../lib/signal/cdsi/cdsiLookup';
import { getSignalTunnelUrl, setSignalProxyUrl, SIGNAL_PRIMARY_DEVICE_ID } from '../../lib/signal/config';
import { closeIdleHttpConnections } from '../../lib/signal/net/http';
import { WebSocketConnectError } from '../../lib/signal/net/WebSocketClient';
import { sendInitialSyncRequests } from '../../lib/signal/sender/syncRequests';
import { initSignalWasm } from '../../lib/signal/wasm';
import { pause } from '../../util/schedulers';
import { buildApiUser, buildApiUserFullInfo } from './builders/users';
import { clearAttachmentCache } from './media/attachments';
import {
  client, db, logError, processor, store,
} from './engine';
import { resetRegistration, resumeRegistration, startRegistration } from './registration';
import { sendApiUpdate } from './updates';

const DEVICE_NAME = 'TeleSignal';
const LINK_QR_LIFETIME_S = 60 * 60;
const LINK_RETRY_DELAY_MS = 3000;
const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 60 * 1000;
const HTTP_UNAUTHORIZED = 401;
const PERCENT = 100;
// The error code of the dialog, see `READABLE_ERROR_KEYS` in `src/util/getReadableErrorText.ts`
const HISTORY_TRANSFER_FAILED_ERROR = 'SIGNAL_HISTORY_TRANSFER_FAILED';
const PRIMARY_UNAUTHORIZED_ERROR = 'SIGNAL_PRIMARY_UNAUTHORIZED';
const SIGNAL_SESSION_DATA: ApiSessionData = { isLinked: true };

let currentAccount: AccountRecord | undefined;
let initialArgs: ApiInitialArgs | undefined;
let reconnectDelay = RECONNECT_MIN_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let linkSession: Awaited<ReturnType<typeof startDeviceLink>> | undefined;
let isDestroyed = false;
let hasSyncedThisSession = false;
// Whether the session reached its first connection attempt, from which it stays connected until it stops
let isConnectionStarted = false;
let isConnecting = false;
// A reconnect that was asked for while a connection attempt was under way, which runs when the attempt ends
let isReconnectPending = false;
// Changes on every stop, so a device link loop of an earlier start ends instead of running beside a new one
let clientGeneration = 0;
let historyTransferController: AbortController | undefined;

/**
 * Connects the stored account, or shows the link QR code until the phone scans it; registration with a phone
 * number starts from there. An account whose registration stopped before its profile resumes at that step, and so
 * does one that the server created while the app was closed before it saw the answer.
 * The app treats an account as authorized even while the connection is down, so local chats stay visible.
 */
export async function startClient(args: ApiInitialArgs) {
  isDestroyed = false;
  initialArgs = args;
  applyProxyUrl(args.signalProxyUrl);
  await initSignalWasm();
  sendApiUpdate({ '@type': 'updateApiReady' });

  const account = await store.getItem('account') ?? await resumeInterruptedRegistration();
  if (account?.isRegistrationPending) {
    sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
    resumeRegistration(account);
    return;
  }
  if (account) {
    await startSession(account);
    return;
  }
  void runDeviceLink(args.platform).catch(logError);
}

/** The account that a registration created before the app stopped, when the server has it */
async function resumeInterruptedRegistration() {
  try {
    return await resumePendingRegistration(store);
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** Leaves the link QR code for registration with a phone number */
export function switchToRegistration() {
  if (currentAccount) return;
  stopDeviceLink();
  startRegistration(initialArgs?.langCode);
}

/** Leaves registration for the link QR code */
export function switchToDeviceLink() {
  if (currentAccount) return;
  resetRegistration();
  stopDeviceLink();
  // The link screen shows a spinner until the provisioning socket sends the new code
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateWaitQrCode' });
  void runDeviceLink(initialArgs?.platform).catch(logError);
}

export function getCurrentAccount() {
  return currentAccount;
}

/** Closes the connections; `shouldForget` also removes the account, every local message and attachment */
export async function stopClient(shouldForget: boolean) {
  isDestroyed = true;
  isConnectionStarted = false;
  isReconnectPending = false;
  clientGeneration++;
  clearTimeout(reconnectTimer);
  linkSession?.cancel();
  resetRegistration();
  historyTransferController?.abort();
  processor.stop();
  client.close();
  resetCdsiState();
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

function stopDeviceLink() {
  clientGeneration++;
  linkSession?.cancel();
  linkSession = undefined;
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

/** Shows the account's chats and connects it; registration calls it once the new account is complete */
export async function startSession(storedAccount: AccountRecord) {
  await discardMessagesOfOtherAccount(storedAccount);

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
    currentUserFullInfo: buildApiUserFullInfo(self, account.aci),
  });
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateReady' });
  // The UI keeps its state and settings only for a stored session; the Signal account lives in the engine's own
  // store, so this session holds no keys and only marks the account slot as linked
  sendApiUpdate({ '@type': 'updateSession', sessionData: SIGNAL_SESSION_DATA });
  if (hasHistoryTransferFailed) {
    sendApiUpdate({ '@type': 'error', error: { message: HISTORY_TRANSFER_FAILED_ERROR, hasErrorKey: true } });
  }

  if (account.isDemo && DEBUG) {
    sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
    return;
  }

  hasSyncedThisSession = false;
  isConnectionStarted = true;
  await connect();
}

/** Messages of an account that unlinked this browser stay only for the next link of that same account */
async function discardMessagesOfOtherAccount({ aci }: AccountRecord) {
  const unlinkedAci = await store.getItem('unlinkedAci');
  if (!unlinkedAci) return;

  if (unlinkedAci !== aci) {
    await db.clear();
    await clearAttachmentCache();
  }
  await store.removeItem('unlinkedAci');
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
 * succeed once for the account, then our profile, a storage service sync and missing or stale contact profiles.
 * A failed step does not stop the others, and the next connection runs them all again.
 */
async function syncAfterConnect() {
  if (hasSyncedThisSession) return;
  hasSyncedThisSession = true;

  let isComplete = true;
  const runStep = async (step: () => Promise<unknown>) => {
    try {
      await step();
    } catch (err) {
      isComplete = false;
      logError(err);
    }
  };

  const context = client.getSenderContext();
  await runStep(async () => {
    if (context.account.isInitialSyncDone) return;
    await sendInitialSyncRequests(context);
    await client.updateAccount({ isInitialSyncDone: true });
  });
  void processor.refreshProfile(context.account.aci).catch(logError);
  await runStep(() => processor.syncStorage());
  void processor.refreshStaleProfiles().catch(logError);

  if (!isComplete) hasSyncedThisSession = false;
}

async function connect() {
  await attemptConnection();

  if (isReconnectPending) {
    isReconnectPending = false;
    reconnectClient();
  }
}

async function attemptConnection() {
  if (isDestroyed) return;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateConnecting' });

  isConnecting = true;
  try {
    await client.connect({
      onContent: (decrypted) => processor.processContent(decrypted),
      onClose: () => scheduleReconnect(),
      onError: logError,
    });
  } catch (err) {
    if (err instanceof WebSocketConnectError && err.status === HTTP_UNAUTHORIZED) {
      await handleUnauthorized();
      return;
    }
    logError(err);
    scheduleReconnect();
    return;
  } finally {
    isConnecting = false;
  }

  reconnectDelay = RECONNECT_MIN_DELAY_MS;
  processor.start();
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateReady' });
  syncAfterConnect().catch(logError);
}

/**
 * Replaces the chat connection at once, for the page to call after the computer slept or the network changed: the
 * old socket can look alive for up to the keepalive timeout, and after failed attempts the next one waits for the
 * backoff. An attempt that is already under way is left to finish, and the reconnect follows it.
 */
export function reconnectClient() {
  if (isDestroyed || !isConnectionStarted || currentAccount?.isDemo) return;
  if (isConnecting) {
    isReconnectPending = true;
    return;
  }

  void reconnect();
}

async function reconnect() {
  isConnecting = true;
  // The close reaches `scheduleReconnect`, whose timer the connection below makes unnecessary
  const drained = client.close();
  clearTimeout(reconnectTimer);
  // The new connection loads the envelopes that are stored but not processed, and the old one still processes them
  await drained;
  isConnecting = false;

  if (isDestroyed) return;
  reconnectDelay = RECONNECT_MIN_DELAY_MS;
  void connect();
}

function scheduleReconnect() {
  if (isDestroyed) return;
  sendApiUpdate({ '@type': 'updateConnectionState', connectionState: 'connectionStateConnecting' });
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => void connect(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
}

/**
 * The chat socket refused our credentials. One authenticated request confirms it before anything is removed: a
 * request that fails otherwise, or one that the server accepts, leaves the account alone and tries again later.
 */
async function handleUnauthorized() {
  const account = currentAccount!;
  try {
    if (await checkAccountAuthorized(account)) {
      scheduleReconnect();
      return;
    }
  } catch (err) {
    logError(err);
    scheduleReconnect();
    return;
  }

  if (account.deviceId === SIGNAL_PRIMARY_DEVICE_ID) {
    handlePrimaryDeregistered();
    return;
  }
  await handleUnlinked(account);
}

/**
 * Our number was registered on another device. Nothing is deleted here: the user decides what happens with the
 * messages, and logging out removes them.
 */
function handlePrimaryDeregistered() {
  processor.stop();
  client.close();
  sendApiUpdate({ '@type': 'error', error: { message: PRIMARY_UNAUTHORIZED_ERROR, hasErrorKey: true } });
}

/**
 * The phone unlinked this device. The account and its keys go and a new link starts; the conversations and messages
 * stay (Signal Desktop `unlinkAndDisconnect`), until another account links (see `startSession`).
 */
async function handleUnlinked(account: AccountRecord) {
  await stopClient(false);
  await store.clear();
  await store.setItem('unlinkedAci', account.aci);
  isDestroyed = false;
  sendApiUpdate({ '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateLoggingOut' });
  void runDeviceLink().catch(logError);
}
