import { addCallback } from '../lib/teact/teactn';
import { getActions, getGlobal } from '../global';

import type { GlobalState } from '../global/types';
import type { PushAccount, PushNotification, PushState } from './push';

import { SESSION_ACCOUNT_PREFIX } from '../config';
import { loadCachedGlobalForSlot } from '../global/cache';
import { selectChat, selectTabState } from '../global/selectors';
import { IS_TAURI } from './browser/globalEnvironment';
import { PUSH_IDB_STORE } from './browser/idb';
import { base64UrlToBuffer, bufferToBase64Url } from './encoding/base64';
import { getDirtySessionKeys, isSessionStoreLocked, writeSessionValue } from './passcode/sessionStore';
import { areArraysShallowEqual } from './areShallowEqual';
import { getCurrentTabId } from './establishMultitabRole';
import { getTranslationFn } from './localization';
import { ACCOUNT_SLOT, getAccountSlots, loadSlotSession, updateSessionStorage } from './multiaccount';
import { parseJsonWithBigInt } from './numbers';
import { getDek, getDekGeneration, loadPasscodeMeta, readGlobalsVaultForSlot } from './passcode';
import {
  getPushKeyId, hashPushValue, PUSH_CLICK_PREFIX, PUSH_CLICK_TIMEOUT_MS, PUSH_DISPLAY_LOCK,
  PUSH_KEY_LENGTH, PUSH_REGISTRATION_LOCK, PUSH_STATE_KEY, readPushState,
} from './push';

// The service worker shows notifications that pages send it and routes their clicks, using the accounts kept in
// push state. Signal has no web push for linked devices, so nothing subscribes to a push service.

const CURRENT_SLOT = ACCOUNT_SLOT || 1;

let pendingClick: PushNotification | undefined;
let lastHandledClickId: string | undefined;
let isOpeningClick = false;
let hasInitialized = false;

export async function refreshPushNotificationState() {
  if (!canPreparePush()) return;

  await navigator.locks.request(PUSH_REGISTRATION_LOCK, preparePushState);
}

async function preparePushState() {
  if (!canPreparePush()) return;

  const generation = getDekGeneration();
  const meta = await loadPasscodeMeta();

  if (meta && (!getDek() || meta.isLocked || meta.isDisabling)) return;

  const previous = await readPushState();
  const accounts = await preparePushAccounts(previous, Boolean(meta));

  if (!accounts || !canPreparePush() || generation !== getDekGeneration()) return;

  const state: PushState = {
    accounts: Object.fromEntries(accounts.map((account) => [account.slot, account])),
    hiddenMessage: getTranslationFn()('NotificationMessageTextHidden'),
    hasPasscode: Boolean(meta),
    revision: await hashPushValue(JSON.stringify([Boolean(meta), accounts])),
  };

  if (!await writePushState(state, previous?.revision)) return;

  if (Object.values(state.accounts).some((account) => account.shouldHidePreviews
    && !previous?.accounts[account.slot]?.shouldHidePreviews)) {
    await clearPrivatePushNotifications();
  }

  notifyPushClientReady();
}

async function preparePushAccounts(previous: PushState | undefined, hasPasscode: boolean) {
  const accounts: PushAccount[] = [];

  for (const slot of getAccountSlots()) {
    let session = loadSlotSession(slot);

    if (!session?.userId) continue;

    const userIdHash = await hashPushValue(session.userId);
    let keyId = session.pushKey ? await getPushKeyId(base64UrlToBuffer(session.pushKey)) : undefined;

    const previousAccount = previous?.accounts[slot];
    const oldAccount = previousAccount && (previousAccount.userHash === userIdHash
      || (keyId && previousAccount.userHash === keyId)) ? previousAccount : undefined;

    let settings = slot === CURRENT_SLOT ? getGlobal().settings.byKey : undefined;

    if (slot !== CURRENT_SLOT && !oldAccount) {
      const snapshot = hasPasscode
        ? parseJsonWithBigInt<Partial<GlobalState>>(await readGlobalsVaultForSlot(slot) || '{}')
        : await loadCachedGlobalForSlot(slot);

      settings = snapshot?.settings?.byKey;
    }

    const shouldShowPreviewsWhenLocked = slot !== CURRENT_SLOT && oldAccount
      ? oldAccount.shouldShowPreviewsWhenLocked
      : Boolean(settings?.shouldShowPushPreviewsWhenLocked);
    const shouldHidePreviews = hasPasscode && !shouldShowPreviewsWhenLocked;

    const sessionKey = `${SESSION_ACCOUNT_PREFIX}${slot}`;

    if (shouldHidePreviews && (!session.pushKey || getDirtySessionKeys().includes(sessionKey))) {
      const pushKey = bufferToBase64Url(crypto.getRandomValues(new Uint8Array(PUSH_KEY_LENGTH)));

      await updateSessionStorage(() => {
        const latest = loadSlotSession(slot);

        if (!latest || latest.userId !== session?.userId || latest.pushKey) return;

        writeSessionValue(sessionKey, JSON.stringify({ ...latest, pushKey }));
      });

      if (getDirtySessionKeys().includes(sessionKey)) throw new Error('Unable to persist push key');

      session = loadSlotSession(slot);

      if (!session?.pushKey || !session.userId) return undefined;

      keyId = await getPushKeyId(base64UrlToBuffer(session.pushKey));
    }

    accounts.push({
      slot,
      userHash: shouldHidePreviews ? keyId! : userIdHash,
      keyId,
      shouldHidePreviews,
      shouldShowPreviewsWhenLocked,
    });
  }

  return accounts;
}

function writePushState(state: PushState, expectedRevision: string | undefined) {
  return navigator.locks.request(PUSH_DISPLAY_LOCK, async () => {
    const previous = await readPushState();

    if (previous?.revision !== expectedRevision) return false;

    for (const account of Object.values(state.accounts)) {
      const oldAccount = previous?.accounts[account.slot];

      if (!oldAccount || oldAccount.userHash === account.userHash) continue;

      const worker = await navigator.serviceWorker.getRegistration();
      const notifications = await worker?.getNotifications?.();

      notifications?.forEach((notification) => {
        if (notification.data?.slot === account.slot && notification.data.userHash === oldAccount.userHash) {
          notification.close();
        }
      });
    }

    await PUSH_IDB_STORE.set(PUSH_STATE_KEY, state);

    return true;
  });
}

export async function suspendPushForPasscode(shouldHideCurrentAccount?: boolean) {
  if (!('serviceWorker' in navigator) || IS_TAURI) return;

  // Publish privacy before waiting for an in-flight state refresh, then again after it
  await pauseDisplay();
  await clearPrivatePushNotifications();

  await navigator.locks.request(PUSH_REGISTRATION_LOCK, pauseDisplay);

  async function pauseDisplay() {
    await navigator.locks.request(PUSH_DISPLAY_LOCK, async () => {
      const state = await readPushState();
      const account = state?.accounts[CURRENT_SLOT];

      if (account && shouldHideCurrentAccount) {
        account.shouldShowPreviewsWhenLocked = false;
        account.shouldHidePreviews = true;
      }

      if (state) {
        await PUSH_IDB_STORE.set(PUSH_STATE_KEY, {
          ...state,
          hasPasscode: true,
          revision: crypto.randomUUID(),
        } satisfies PushState);
      }

      const worker = await navigator.serviceWorker.getRegistration();
      const notifications = await worker?.getNotifications?.();

      notifications?.forEach((notification) => notification.close());
    });
  }
}

export async function clearPrivatePushNotifications() {
  if (!('serviceWorker' in navigator) || IS_TAURI) return;

  await navigator.locks.request(PUSH_DISPLAY_LOCK, async () => {
    const meta = await loadPasscodeMeta();
    const state = await readPushState();

    if (!meta && !state?.hasPasscode) return;

    const worker = await navigator.serviceWorker.getRegistration();
    const notifications = await worker?.getNotifications?.();

    notifications?.forEach((notification) => {
      const data: PushNotification = notification.data;

      if (!state?.accounts[data?.slot]?.shouldShowPreviewsWhenLocked && !data?.isGeneric) notification.close();
    });

    const entries = await PUSH_IDB_STORE.entries();

    await Promise.all(entries.flatMap(([key, value]) => {
      const data = value as PushNotification | undefined;

      return typeof key === 'string' && key.startsWith(PUSH_CLICK_PREFIX) && data
        && !state?.accounts[data.slot]?.shouldShowPreviewsWhenLocked ? [PUSH_IDB_STORE.del(key)] : [];
    }));
  });
}

export async function unregisterPushAccount(shouldRemoveAll?: boolean) {
  if (!('serviceWorker' in navigator) || IS_TAURI) return;

  await navigator.locks.request(PUSH_REGISTRATION_LOCK, () => navigator.locks.request(PUSH_DISPLAY_LOCK, async () => {
    const worker = await navigator.serviceWorker.getRegistration();
    const notifications = await worker?.getNotifications?.();

    notifications?.forEach((notification) => {
      if (shouldRemoveAll || notification.data?.slot === CURRENT_SLOT) notification.close();
    });

    if (shouldRemoveAll) {
      await PUSH_IDB_STORE.clear();
      return;
    }

    const latest = await readPushState();

    if (latest) {
      if (!loadSlotSession(CURRENT_SLOT)) delete latest.accounts[CURRENT_SLOT];

      latest.revision = crypto.randomUUID();
      await PUSH_IDB_STORE.set(PUSH_STATE_KEY, latest);
    }

    await PUSH_IDB_STORE.del(`${PUSH_CLICK_PREFIX}${CURRENT_SLOT}`);
  }));
}

export async function getPushIdentity() {
  const userId = getGlobal().currentUserId;

  if (!userId) return undefined;

  const state = await readPushState();

  // The worker drops notifications for accounts missing from push state
  if (!state?.accounts[CURRENT_SLOT]) return undefined;

  const meta = await loadPasscodeMeta();

  const account = state.accounts[CURRENT_SLOT];
  let userHash: string;

  if (account.shouldHidePreviews) {
    const session = loadSlotSession(CURRENT_SLOT);

    if (!session?.pushKey || session.userId !== userId) return undefined;

    userHash = await getPushKeyId(base64UrlToBuffer(session.pushKey));
  } else {
    userHash = await hashPushValue(userId);
  }

  return {
    slot: CURRENT_SLOT,
    userHash,
    revision: state.revision,
    lockEpoch: meta?.lockEpoch,
  };
}

export function initPushNotifications() {
  if (hasInitialized || !('serviceWorker' in navigator) || IS_TAURI) return;

  hasInitialized = true;

  let previousSignature: unknown[] = [];
  let wasReady = false;

  addCallback(() => {
    const global = getGlobal();

    if (!global.isInited) return;

    const settings = global.settings.byKey;

    if (global.passcode.isScreenLocked && !settings.shouldShowPushPreviewsWhenLocked) {
      pendingClick = undefined;
    }

    const signature = [
      global.currentUserId,
      global.passcode.hasPasscode,
      global.passcode.isScreenLocked,
      settings.shouldShowPushPreviewsWhenLocked,
    ];

    if (!areArraysShallowEqual(signature, previousSignature)) {
      previousSignature = signature;

      if (canPreparePush()) void refreshPushNotificationState();
    }

    if (pendingClick) void openPendingPushClick();

    const isReady = canHandlePush();
    if (isReady && !wasReady) notifyPushClientReady();
    wasReady = isReady;
  });

  void refreshPushNotificationState();
}

export async function handlePushWorkerMessage(e: MessageEvent) {
  const { type, payload } = e.data || {};

  if (type !== 'openPushNotification' || !payload?.id || payload.id === lastHandledClickId) return;

  if (pendingClick?.id !== payload.id || pendingClick?.userHash !== payload.userHash) pendingClick = payload;

  await openPendingPushClick();
}

export function notifyPushClientReady() {
  if (!canHandlePush()) return;

  void getPushIdentity().then((identity) => {
    navigator.serviceWorker.controller?.postMessage({ type: 'pushClientReady', payload: identity });
  });
}

async function openPendingPushClick() {
  if (!pendingClick || isOpeningClick || !canHandlePush()) return;

  isOpeningClick = true;
  const notification = pendingClick;

  try {
    if (Date.now() - (notification.clickedAt || 0) > PUSH_CLICK_TIMEOUT_MS) {
      // A click that waited too long for the app to load would navigate unexpectedly
      if (pendingClick === notification) pendingClick = undefined;
      navigator.serviceWorker.controller?.postMessage({
        type: 'pushClickHandled',
        payload: { id: notification.id, userHash: notification.userHash },
      });
      return;
    }

    const identity = await getPushIdentity();

    if (identity?.slot !== notification.slot || identity.userHash !== notification.userHash) {
      // The worker keeps the click and delivers it again on the next `pushClientReady`
      if (pendingClick === notification) pendingClick = undefined;
      return;
    }

    const generation = getDekGeneration();
    const meta = await loadPasscodeMeta();

    if (meta?.isLocked || !canHandlePush() || generation !== getDekGeneration()) return;

    openPushTarget(notification);

    lastHandledClickId = notification.id;
    navigator.serviceWorker.controller?.postMessage({
      type: 'pushClickHandled',
      payload: { id: notification.id, userHash: identity.userHash },
    });

    if (pendingClick === notification) pendingClick = undefined;
  } finally {
    isOpeningClick = false;

    if (pendingClick && pendingClick !== notification) void openPendingPushClick();
  }
}

function openPushTarget(target: PushNotification) {
  const actions = getActions();
  const tabId = getCurrentTabId();

  if (target.kind === 'story' && (target.chatId || target.isStoryReaction)) {
    actions.openChat({ id: undefined, tabId });

    actions.openStoryViewer({
      peerId: target.isStoryReaction ? getGlobal().currentUserId! : target.chatId!,
      storyId: target.storyId,
      tabId,
    });
  } else if (target.chatId && selectChat(getGlobal(), target.chatId)) {
    if (target.messageId) {
      actions.focusMessage({
        chatId: target.chatId,
        messageId: target.messageId,
        threadId: target.threadId,
        shouldReplaceHistory: target.shouldReplaceHistory,
        tabId,
      });
    } else {
      actions.openChat({ id: target.chatId, tabId });
    }
  } else {
    actions.openChat({ id: undefined, tabId });
  }
}

function canPreparePush() {
  const global = getGlobal();

  return global.isInited
    && !IS_TAURI
    && 'serviceWorker' in navigator
    && !isSessionStoreLocked()
    && !global.passcode.isScreenLocked
    && Boolean(global.currentUserId);
}

function canHandlePush() {
  const global = getGlobal();

  return global.isInited
    && !global.passcode.isScreenLocked
    && Boolean(global.currentUserId)
    && Boolean(global.isSynced)
    && (!global.passcode.hasPasscode || Boolean(getDek()))
    && global.connectionState === 'connectionStateReady'
    && selectTabState(global, getCurrentTabId())?.uiReadyState === 2;
}
