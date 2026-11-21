import type { NotificationDefaults } from '../../../lib/signal/store/SignalStore';
import type {
  ApiConfig, ApiNotifyPeerType, ApiPeer, ApiPeerColors, ApiPeerNotifySettings, ApiSignalMessageSettings,
} from '../../types';

import { MUTE_INDEFINITE_TIMESTAMP, UNMUTE_TIMESTAMP } from '../../../config';
import { SyncMessage_MessageRequestResponse_Type } from '../../../lib/signal/proto/generated/SignalService_pb';
import { buildCollectionByKey } from '../../../util/iteratees';
import { getServerTime } from '../../../util/serverTime';
import { buildApiChat } from '../builders/chats';
import { AVATAR_COLORS, buildApiUser } from '../builders/users';
import { getCurrentAccount } from '../client';
import { db, logError, processor, store } from '../engine';
import { getConversationByPeerId, getPeerId } from '../peers';
import { sendApiUpdate } from '../updates';

// The config is local, so it is checked again only once a day
const CONFIG_TTL = 24 * 60 * 60;
// Signal messages can be edited for a day after sending (`EDIT_MAX_AGE_MS` in `MessageProcessor`)
const EDIT_TIME_LIMIT = 24 * 60 * 60;
// Signal Desktop `global.groupsv2.groupSizeHardLimit`, ourselves included
const MAX_GROUP_SIZE = 1001;
// Signal Desktop `MAX_PLAINTEXT_BODY_ATTACHMENT_BYTE_LENGTH` in `ts/util/longAttachment.std.ts`
const MAX_MESSAGE_LENGTH = 64 * 1024;

/** The message settings with the values Signal Desktop uses until they are set */
export async function fetchSignalMessageSettings(): Promise<ApiSignalMessageSettings | undefined> {
  const account = await store.getItem('account');
  if (!account) return undefined;
  return {
    isReadReceiptsEnabled: account.isReadReceiptsEnabled ?? false,
    isTypingIndicatorsEnabled: account.isTypingIndicatorsEnabled ?? true,
    isLinkPreviewsEnabled: account.isLinkPreviewsEnabled ?? true,
    isSealedSenderIndicatorsEnabled: account.isSealedSenderIndicatorsEnabled ?? false,
  };
}

/** Resolves with the settings after the change, or `undefined` when it failed */
export async function updateSignalMessageSettings(update: Partial<ApiSignalMessageSettings>) {
  try {
    await processor.updateMessageSettings(update);
    return fetchSignalMessageSettings();
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/** The disappearing messages timer that new private chats start with; 0 is off */
export async function fetchDefaultHistoryTtl() {
  const account = await store.getItem('account');
  return account ? account.universalExpireTimer ?? 0 : undefined;
}

export async function setDefaultHistoryTtl({ period }: { period: number }) {
  try {
    await processor.updateMessageSettings({ universalExpireTimer: period || undefined });
    return true as const;
  } catch (err) {
    logError(err);
    return undefined;
  }
}

/**
 * Signal limits in the shape of Telegram's config. Forwarded messages are sent one by one, so they are not
 * split into batches, and there are no server-side top peer ratings.
 */
export function fetchConfig() {
  return Promise.resolve<ApiConfig>({
    expiresAt: getServerTime() + CONFIG_TTL,
    maxGroupSize: MAX_GROUP_SIZE,
    maxMessageLength: MAX_MESSAGE_LENGTH,
    editTimeLimit: EDIT_TIME_LIMIT,
    maxForwardedCount: 0,
    ratingEDecay: 0,
  });
}

/** Signal's avatar colors as the app's peer colors; users and chats pick one in `buildAvatarColor` */
export function fetchPeerColors() {
  return Promise.resolve<{ colors: ApiPeerColors['general']; hash: undefined }>({
    hash: undefined,
    colors: Object.fromEntries(AVATAR_COLORS.map((color, index) => [index, { colors: [color] }])),
  });
}

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
