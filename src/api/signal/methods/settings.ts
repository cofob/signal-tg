import type { NotificationDefaults } from '../../../lib/signal/store/SignalStore';
import type { ApiNotifyPeerType, ApiPeer, ApiPeerNotifySettings } from '../../types';

import { MUTE_INDEFINITE_TIMESTAMP, UNMUTE_TIMESTAMP } from '../../../config';
import { SyncMessage_MessageRequestResponse_Type } from '../../../lib/signal/proto/generated/SignalService_pb';
import { buildCollectionByKey } from '../../../util/iteratees';
import { buildApiChat } from '../builders/chats';
import { buildApiUser } from '../builders/users';
import { getCurrentAccount } from '../client';
import { db, logError, processor, store } from '../engine';
import { getConversationByPeerId, getPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

/** Blocked contacts and groups; all of them come in one page */
export async function fetchBlockedUsers({ isOnlyStories }: { isOnlyStories?: true }) {
  const selfAci = getCurrentAccount()?.aci;
  if (!selfAci || isOnlyStories) return undefined;

  const blocked = (await db.getConversations()).filter(({ isBlocked }) => isBlocked);
  const users = blocked
    .filter(({ type }) => type === 'private')
    .map((conversation) => buildApiUser(conversation, selfAci));
  const chats = blocked
    .filter(({ type }) => type === 'group')
    .map((conversation) => buildApiChat(conversation, selfAci));
  sendApiUpdate({
    '@type': 'updateEntities',
    users: buildCollectionByKey(users, 'id'),
    chats: buildCollectionByKey(chats, 'id'),
  });

  return {
    blockedIds: blocked.map(getPeerId),
    totalCount: blocked.length,
  };
}

/** Blocking answers the message request as Signal Desktop does from the chat menu, whatever its state */
export async function blockUser({ user }: { user: ApiPeer; isOnlyStories?: true }) {
  const conversation = await getConversationByPeerId(user.id);
  if (!conversation) return undefined;

  try {
    await processor.respondToMessageRequest(conversation.id, SyncMessage_MessageRequestResponse_Type.BLOCK);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

export async function unblockUser({ user }: { user: ApiPeer; isOnlyStories?: true }) {
  const conversation = await getConversationByPeerId(user.id);
  if (!conversation) return undefined;

  try {
    await processor.unblock(conversation.id);
    return true;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/**
 * Notification defaults by chat type, which stay on this device. Previews on and off stand for Signal's
 * notification content "Name and message" and "Name only".
 */
export async function fetchNotifyDefaultSettings(): Promise<Record<ApiNotifyPeerType, ApiPeerNotifySettings>> {
  const defaults = await store.getItem('notificationDefaults');
  return {
    users: buildNotifyDefaults(defaults?.users),
    groups: buildNotifyDefaults(defaults?.groups),
    channels: buildNotifyDefaults(defaults?.channels),
  };
}

export async function updateNotificationSettings(peerType: ApiNotifyPeerType, {
  isMuted, shouldShowPreviews,
}: {
  isMuted?: boolean;
  shouldShowPreviews?: boolean;
}) {
  const defaults = await store.getItem('notificationDefaults');
  await store.setItem('notificationDefaults', { ...defaults, [peerType]: { isMuted, shouldShowPreviews } });
  return true;
}

function buildNotifyDefaults({ isMuted, shouldShowPreviews = true }: NotificationDefaults = {}): ApiPeerNotifySettings {
  return {
    mutedUntil: isMuted ? MUTE_INDEFINITE_TIMESTAMP : UNMUTE_TIMESTAMP,
    hasSound: true,
    shouldShowPreviews,
  };
}
