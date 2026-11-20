import type { PushAccount, PushNotification } from '../util/push';

import { ACCOUNT_QUERY, APP_NAME } from '../config';
import { getAccountSlot } from '../util/accountSlot';
import { PUSH_IDB_STORE } from '../util/browser/idb';
import { loadPasscodeMeta } from '../util/passcode/meta';
import {
  hashPushValue, PUSH_CLICK_PREFIX, PUSH_CLICK_TIMEOUT_MS, PUSH_DISPLAY_LOCK, readPushState,
} from '../util/push';

declare const self: ServiceWorkerGlobalScope;

const VIBRATION_PATTERN = [200, 100, 200];
const DEDUPLICATION_TIMEOUT_MS = 60 * 1000;
const NOTIFICATION_ICON = 'icon-192x192.png';
const shownNotifications = new Map<string, number>();

// Pages ask the worker to show their notifications. Signal has no web push for linked devices, so nothing
// subscribes to a push service and the worker never receives `push` events
async function showNotification(notification: PushNotification) {
  return navigator.locks.request(PUSH_DISPLAY_LOCK, async () => {
    const state = await readPushState();
    const account = state?.accounts[notification.slot];
    if (!state || !account || account.userHash !== notification.userHash) return;
    const meta = await loadPasscodeMeta();
    if (notification.revision !== state.revision || notification.lockEpoch !== meta?.lockEpoch) return;
    const shouldHide = (state.hasPasscode || Boolean(meta)) && !account.shouldShowPreviewsWhenLocked
      && Boolean(meta?.isLocked);
    const isGeneric = notification.isGeneric || shouldHide;
    const data: PushNotification = isGeneric ? {
      slot: account.slot,
      userHash: account.userHash,
      title: APP_NAME,
      body: state.hiddenMessage,
      isGeneric: true,
      isSilent: notification.isSilent,
    } : notification;
    const reactionIdentity = data.kind === 'reaction' ? `:${JSON.stringify([data.title, data.body])}` : '';
    // A generic notification keeps no routing, so it is never deduplicated
    const identity = isGeneric ? crypto.randomUUID() : `${account.userHash}:${data.kind || 'message'}:${
      data.chatId || ''}:${data.storyId || data.messageId || 'generic'}${reactionIdentity}`;
    const id = await hashPushValue(identity);
    const now = Date.now();
    shownNotifications.forEach((date, key) => {
      if (now - date > DEDUPLICATION_TIMEOUT_MS) shownNotifications.delete(key);
    });
    if (shownNotifications.has(id)) return;
    const notifications = await self.registration.getNotifications();
    if (notifications.some((item) => item.data?.id === id)) return;
    const tag = await hashPushValue(`${account.userHash}:${data.kind || 'message'}:${data.chatId || 'generic'}`);
    // Pages play their own sound unless they ask for the system sound, which also vibrates
    const isSilent = Boolean(data.isSilent) || !notification.shouldUseSystemSound;
    const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
      body: data.body,
      icon: data.icon || NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      tag,
      silent: isSilent,
      renotify: !isSilent,
      vibrate: isSilent ? undefined : VIBRATION_PATTERN,
      data: { ...data, id },
    };
    await self.registration.showNotification(data.title, options);
    shownNotifications.set(id, now);
    return id;
  });
}

async function getAccountClients(account: PushAccount) {
  const scope = new URL(self.registration.scope);
  const clients = await self.clients.matchAll({ type: 'window' });
  return clients.filter((client) => {
    const url = new URL(client.url);
    // Slots are unique across servers, and a tab connects to its session's server whether or not `?test` is set
    return url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
      && (getAccountSlot(client.url) || 1) === account.slot;
  });
}

export function handleNotificationClick(e: NotificationEvent) {
  e.notification.close();
  e.waitUntil(openNotification(e.notification.data).catch(() => undefined));
}

async function openNotification(data: PushNotification) {
  let localTarget: PushNotification | undefined;
  let client: WindowClient | undefined;
  const account = await navigator.locks.request(PUSH_DISPLAY_LOCK, async () => {
    const state = await readPushState();
    const currentAccount = state?.accounts[data?.slot];
    if (!currentAccount || currentAccount.userHash !== data.userHash) return undefined;
    const meta = await loadPasscodeMeta();
    const shouldHide = (state?.hasPasscode || Boolean(meta)) && !currentAccount.shouldShowPreviewsWhenLocked;
    const clients = await getAccountClients(currentAccount);
    client = clients.find((candidate) => candidate.focused) || clients[0];
    // A legacy plaintext click must not reintroduce protected routing into IndexedDB
    const target: PushNotification = {
      slot: data.slot, userHash: data.userHash,
      title: '', body: '', id: crypto.randomUUID(),
      clientId: client?.id,
      clickedAt: Date.now(),
      chatId: shouldHide ? undefined : data.chatId,
      messageId: shouldHide ? undefined : data.messageId,
      threadId: shouldHide ? undefined : data.threadId,
      storyId: shouldHide ? undefined : data.storyId,
      isStoryReaction: shouldHide ? undefined : data.isStoryReaction,
      kind: shouldHide ? undefined : data.kind,
      shouldReplaceHistory: data.shouldReplaceHistory,
    };
    await PUSH_IDB_STORE.set(`${PUSH_CLICK_PREFIX}${data.slot}`, target);
    if (shouldHide && !meta?.isLocked && data.revision && data.lockEpoch === meta?.lockEpoch) {
      // An unlocked local click can navigate immediately without persisting plaintext routing
      localTarget = {
        ...data, title: '', body: '', icon: undefined, id: target.id, clickedAt: target.clickedAt,
      };
    }
    return currentAccount;
  });
  if (!account) {
    // Notifications without a known account (e.g. shown by the page itself) still bring the app forward
    const [anyClient] = await self.clients.matchAll({ type: 'window' });
    await (anyClient ? anyClient.focus() : self.clients.openWindow(self.registration.scope));
    return;
  }
  if (client) {
    await client.focus().catch(() => undefined);
    await deliverPendingClick(client, account, localTarget);
    return;
  }
  const url = new URL(self.registration.scope);
  if (account.slot !== 1) url.searchParams.set(ACCOUNT_QUERY, String(account.slot));
  if (account.isTest) url.searchParams.set('test', 'true');
  await self.clients.openWindow(url.href);
}

async function deliverPendingClick(client: Client, account: PushAccount, localTarget?: PushNotification) {
  await navigator.locks.request(PUSH_DISPLAY_LOCK, async () => {
    const key = `${PUSH_CLICK_PREFIX}${account.slot}`;
    const data = await PUSH_IDB_STORE.get<PushNotification>(key);
    if (!data || data.userHash !== account.userHash) return;
    if (Date.now() - (data.clickedAt || 0) > PUSH_CLICK_TIMEOUT_MS) {
      await PUSH_IDB_STORE.del(key);
      return;
    }
    const clients = await getAccountClients(account);
    if (data.clientId && data.clientId !== client.id
      && clients.some((candidate) => candidate.id === data.clientId)) return;
    data.clientId = client.id;
    await PUSH_IDB_STORE.set(key, data);
    const meta = await loadPasscodeMeta();
    const payload = localTarget && localTarget.id === data.id && !meta?.isLocked
      && localTarget.lockEpoch === meta?.lockEpoch
      ? localTarget : data;
    // One window owns the click until it closes or acknowledges after unlocking and loading its data
    client.postMessage({ type: 'openPushNotification', payload });
  });
}

export function handleClientMessage(e: ExtendableMessageEvent) {
  e.waitUntil(processClientMessage(e).catch(() => undefined));
}

async function processClientMessage(e: ExtendableMessageEvent) {
  if (!e.data || !e.source || !('url' in e.source)) return;
  const source = await self.clients.get(e.source.id);
  if (!source) return;
  const state = await readPushState();
  const slot = getAccountSlot(source.url) || 1;
  const account = state?.accounts[slot];
  if (!account || !(await getAccountClients(account)).some((client) => client.id === source.id)) return;
  const payload = e.data.payload;
  switch (e.data.type) {
    case 'pushClientReady':
      if (payload?.userHash === account.userHash) await deliverPendingClick(source, account);
      break;
    case 'pushClickHandled': {
      const key = `${PUSH_CLICK_PREFIX}${slot}`;
      await PUSH_IDB_STORE.update<PushNotification | undefined>(key, (pending) => (
        pending?.id === payload?.id && pending?.userHash === payload?.userHash ? undefined : pending
      ));
      break;
    }
    case 'showMessageNotification': {
      if (payload?.userHash !== account.userHash || payload?.slot !== slot) return;
      const id = await showNotification(payload);
      if (id && !payload.isSilent && !payload.shouldUseSystemSound && payload.kind !== 'reaction') {
        source.postMessage({ type: 'playNotificationSound', payload: { id } });
      }
      break;
    }
    case 'closeMessageNotifications': {
      if (payload?.userHash !== account.userHash) return;
      const maxId = payload.lastReadInboxMessageId;
      await navigator.locks.request(PUSH_DISPLAY_LOCK, () => (
        closeNotifications(account, payload.chatId, maxId, maxId !== undefined)
      ));
      break;
    }
  }
}

async function closeNotifications(
  account: PushAccount, chatId: string, maxId = Number.MAX_SAFE_INTEGER, shouldCloseGeneric?: boolean,
) {
  const notifications = await self.registration.getNotifications();
  notifications.forEach((notification) => {
    const data: PushNotification = notification.data;
    if (data?.userHash !== account.userHash) return;
    // Generic notifications hide their chat, so any read reported by the app clears them
    if ((shouldCloseGeneric && data.isGeneric) || (data.chatId === chatId
      && data.kind !== 'story'
      && data.messageId && data.messageId <= maxId)) notification.close();
  });
}
