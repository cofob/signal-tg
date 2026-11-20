import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { ApiPeerSettings, ApiUser, ApiUserFullInfo } from '../../types';

import { getIsConversationAccepted } from '../../../lib/signal/messages/messageRequests';
import { getPeerId } from '../peers';

const HASH_MULTIPLIER = 31;

/** Builds the user of a private conversation; `selfAci` marks our own user (Note to Self) */
export function buildApiUser(conversation: ConversationRecord, selfAci: string): ApiUser {
  const [firstName, lastName] = getUserNames(conversation);
  return {
    id: getPeerId(conversation),
    isMin: false,
    isSelf: conversation.id === selfAci ? true : undefined,
    isContact: conversation.systemName ? true : undefined,
    type: 'userTypeRegular',
    firstName,
    lastName,
    phoneNumber: conversation.e164?.replace(/^\+/, '') ?? '',
    usernames: conversation.username ? [{ username: conversation.username, isActive: true }] : undefined,
    hasUsername: Boolean(conversation.username),
    avatarPhotoId: getAvatarPhotoId(conversation),
  };
}

export function buildApiUserFullInfo(conversation: ConversationRecord, selfAci: string): ApiUserFullInfo {
  return {
    bio: [conversation.aboutEmoji, conversation.about].filter(Boolean).join(' ') || undefined,
    isBlocked: Boolean(conversation.isBlocked),
    ttlPeriod: conversation.expireTimer,
    settings: buildPeerSettings(conversation, selfAci),
  };
}

/**
 * A message request shows the chat header bar with accepting, deleting, blocking and reporting; a blocked
 * conversation shows the unblock bar instead
 */
export function buildPeerSettings(conversation: ConversationRecord, selfAci: string): ApiPeerSettings {
  const isMessageRequest = !conversation.isBlocked && !getIsConversationAccepted(conversation, selfAci);
  return isMessageRequest ? { isMessageRequest: true, canBlockContact: true, canReportSpam: true } : {};
}

/** People in the phone's contacts or whose message request we accepted, whom Signal Desktop offers to write to */
export function getIsContact(conversation: ConversationRecord, selfAci: string) {
  return conversation.type === 'private' && conversation.id !== selfAci && !conversation.isBlocked
    && Boolean(conversation.systemName || conversation.isAccepted);
}

/**
 * The avatar id of a user or group: a hash of its CDN path, so it changes with the avatar.
 * `downloadMedia` resolves `avatar<peerId>?<avatarPhotoId>` through the conversation's `avatarPath`.
 */
export function getAvatarPhotoId(conversation: ConversationRecord) {
  const { avatarPath } = conversation;
  if (!avatarPath) return undefined;
  let hash = 0;
  for (let i = 0; i < avatarPath.length; i++) {
    hash = Math.imul(hash, HASH_MULTIPLIER) + avatarPath.charCodeAt(i) | 0;
  }
  return String(hash >>> 0);
}

/** Names in Signal's priority: nickname, then the name from the phone's contacts, then the profile name */
function getUserNames(conversation: ConversationRecord): [string | undefined, string | undefined] {
  const name = conversation.nickname ?? conversation.systemName;
  if (name) return [name, undefined];
  if (conversation.profileName) return [conversation.profileName, conversation.profileFamilyName];
  return [conversation.e164 ?? conversation.username, undefined];
}
