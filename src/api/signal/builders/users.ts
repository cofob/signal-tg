import type { ConversationRecord } from '../../../lib/signal/db/MessageDb';
import type { ApiPeerColor, ApiPeerSettings, ApiUser, ApiUserFullInfo } from '../../types';

import { sha256Sync } from '../../../lib/signal/crypto';
import { uuidToBytes } from '../../../lib/signal/serviceId';
import { bufferFromBase64 } from '../../../util/encoding/buffer';
import { getPeerId } from '../peers';

const HASH_MULTIPLIER = 31;
// Signal avatar colors in `AvatarColors` order: the foreground colors of `AxoTokens.Avatar`
// (Signal Desktop `ts/axo/AxoTokens.std.ts`)
export const AVATAR_COLORS = [
  '#3838f5', '#1251d3', '#086da0', '#067906', '#661aff', '#9f00f0',
  '#b8057c', '#be0404', '#836b01', '#7d6f40', '#4f4f6d', '#5c5c5c',
];

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
    color: buildAvatarColor(conversation),
  };
}

/**
 * The avatar color of a user or group: the first SHA-256 byte of the ACI or group id picks one of
 * `AVATAR_COLORS` (Signal Desktop `generateAvatarColor` in `ts/Crypto.node.ts`)
 */
export function buildAvatarColor(conversation: ConversationRecord): ApiPeerColor {
  const identifier = conversation.type === 'private' ? uuidToBytes(conversation.id) : bufferFromBase64(conversation.id);
  return { type: 'regular', color: sha256Sync(identifier)[0] % AVATAR_COLORS.length };
}

export function buildApiUserFullInfo(conversation: ConversationRecord): ApiUserFullInfo {
  return {
    bio: [conversation.aboutEmoji, conversation.about].filter(Boolean).join(' ') || undefined,
    isBlocked: Boolean(conversation.isBlocked),
    ttlPeriod: conversation.expireTimer,
    settings: buildPeerSettings(conversation),
  };
}

/**
 * A message request shows the chat header bar with blocking and reporting. It is a private conversation with
 * messages from someone outside our contacts that we neither accepted nor answered; writing first accepts it
 * (Signal Desktop `ts/util/isConversationAccepted.preload.ts`).
 */
export function buildPeerSettings(conversation: ConversationRecord): ApiPeerSettings {
  const isMessageRequest = conversation.type === 'private' && !conversation.isAccepted && !conversation.systemName
    && !conversation.isBlocked && conversation.lastMessageId !== undefined;
  return isMessageRequest ? { canBlockContact: true, canReportSpam: true } : {};
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
